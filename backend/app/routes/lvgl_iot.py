"""Stable v1 machine API for the IoT backend; never accepts browser sessions."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import zipfile
from datetime import datetime
from enum import Enum
from pathlib import PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import AnyHttpUrl, BaseModel, Field

from ..tools.lvgl_builds import db as build_db
from ..tools.lvgl_iot import db as integration_db
from ..tools.lvgl_iot.security import require_scope


router = APIRouter()
integration_db.init_db()


class IoTBuildStatus(str, Enum):
    queued = "queued"
    validating = "validating"
    building = "building"
    succeeded = "succeeded"
    failed = "failed"
    approved = "approved"
    published = "published"
    superseded = "superseded"
    rolled_back = "rolled_back"


class IoTBuildV1(BaseModel):
    apiVersion: Literal["iot.lvgl/v1"] = "iot.lvgl/v1"
    uiBuildId: str
    uiProjectRevision: int = Field(..., ge=1)
    buildTargetRevision: int = Field(..., ge=1)
    lvglVersion: str
    uiAbiVersion: str
    generatorVersion: str
    firmwareCapabilitySha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    artifactSha256: str | None = Field(None, pattern=r"^[0-9a-f]{64}$")
    manifestUrl: AnyHttpUrl
    previewUrl: AnyHttpUrl
    artifactUrl: AnyHttpUrl
    previewAvailable: bool = False
    status: IoTBuildStatus
    createdAt: datetime
    updatedAt: datetime


class IoTBuildListV1(BaseModel):
    apiVersion: Literal["iot.lvgl/v1"] = "iot.lvgl/v1"
    builds: list[IoTBuildV1]


class IoTExchangeV1(BaseModel):
    apiVersion: Literal["iot.lvgl/v1"] = "iot.lvgl/v1"
    eventType: Literal[
        "build.associated", "build.approved", "build.published",
        "build.superseded", "build.rolled_back", "device.reported",
    ]
    uiBuildId: str = Field(..., min_length=1, max_length=160)
    externalRef: str | None = Field(None, max_length=240)
    artifactSha256: str | None = Field(None, pattern=r"^[0-9a-f]{64}$")
    deviceId: str | None = Field(None, max_length=160)
    occurredAt: datetime
    details: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class IoTExchangeResultV1(BaseModel):
    apiVersion: Literal["iot.lvgl/v1"] = "iot.lvgl/v1"
    exchangeId: str
    duplicate: bool
    eventType: str
    uiBuildId: str
    createdAt: datetime


class IoTExchangeListV1(BaseModel):
    apiVersion: Literal["iot.lvgl/v1"] = "iot.lvgl/v1"
    exchanges: list[dict[str, Any]]


def _revision(reference: Any) -> int:
    match = re.search(r"@(\d+)$", reference) if isinstance(reference, str) else None
    if match is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "build-contract-incomplete", "message": "build is missing a revisioned UI project reference"},
        )
    return int(match.group(1))


def _url(request: Request, route_name: str, build_id: str) -> str:
    return str(request.url_for(route_name, build_id=build_id))


def _dto(request: Request, owner_user_id: int, build: dict[str, Any]) -> IoTBuildV1:
    input_lock = build.get("inputLock", {})
    generator = input_lock.get("generator", {})
    target = input_lock.get("buildTarget", {})
    capability_hash = input_lock.get("firmwareCapabilitySha256")
    ui_abi = generator.get("uiAbiVersion")
    if not isinstance(capability_hash, str) or not isinstance(ui_abi, str):
        raise HTTPException(
            status_code=409,
            detail={"code": "build-contract-incomplete", "message": "build predates the UI ABI capability contract"},
        )
    artifact = build_db.get_artifact(owner_user_id, build["id"])
    generator_manifest = build.get("manifest", {}).get("generator", {}) if build.get("manifest") else {}
    sealed_preview = generator_manifest.get("sealedPreview", {}) if isinstance(generator_manifest, dict) else {}
    preview_available = artifact is not None and sealed_preview.get("status") == "sealed"
    return IoTBuildV1(
        uiBuildId=build["id"],
        uiProjectRevision=_revision(target.get("uiProjectRef")),
        buildTargetRevision=_revision(build.get("buildTargetRef")),
        lvglVersion=generator.get("lvglVersion", ""),
        uiAbiVersion=ui_abi,
        generatorVersion=generator.get("version", ""),
        firmwareCapabilitySha256=capability_hash,
        artifactSha256=None if artifact is None else artifact["sha256"],
        manifestUrl=_url(request, "iot_build_manifest_v1", build["id"]),
        previewUrl=_url(request, "iot_build_preview_v1", build["id"]),
        artifactUrl=_url(request, "iot_build_artifact_v1", build["id"]),
        previewAvailable=preview_available,
        status=build["state"],
        createdAt=build["createdAt"],
        updatedAt=build["updatedAt"],
    )


def _build_or_404(principal: dict[str, Any], build_id: str) -> dict[str, Any]:
    build = build_db.get_build(principal["ownerUserId"], build_id, include_input=True)
    if build is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "build-not-found", "message": "build not found"},
        )
    return build


def _preview_member(
    principal: dict[str, Any], build: dict[str, Any], relative_path: str,
) -> tuple[bytes, str]:
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise HTTPException(status_code=404, detail={"code": "preview-file-not-found", "message": "preview file not found"})
    archive_path = f"preview/{pure.as_posix()}"
    manifest = build.get("manifest")
    entries = manifest.get("files", []) if isinstance(manifest, dict) else []
    expected = next((item for item in entries if item.get("path") == archive_path), None)
    artifact = build_db.get_artifact(principal["ownerUserId"], build["id"])
    if expected is None or artifact is None or not artifact["path"].is_file():
        raise HTTPException(
            status_code=404,
            detail={"code": "preview-not-available", "message": "this build has no sealed preview artifact"},
        )
    if hashlib.sha256(artifact["path"].read_bytes()).hexdigest() != artifact["sha256"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "artifact-integrity-failed", "message": "stored artifact hash mismatch"},
        )
    try:
        with zipfile.ZipFile(artifact["path"]) as archive:
            info = archive.getinfo(archive_path)
            if info.file_size != expected.get("byteSize"):
                raise HTTPException(
                    status_code=409,
                    detail={"code": "preview-integrity-failed", "message": "preview member size mismatch"},
                )
            payload = archive.read(info)
    except (KeyError, zipfile.BadZipFile) as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "preview-integrity-failed", "message": "sealed preview member is missing or invalid"},
        ) from exc
    digest = hashlib.sha256(payload).hexdigest()
    if digest != expected.get("sha256"):
        raise HTTPException(
            status_code=409,
            detail={"code": "preview-integrity-failed", "message": "preview member hash mismatch"},
        )
    return payload, digest


def _preview_response(payload: bytes, digest: str, path: str) -> Response:
    media_type = {
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
    }.get(PurePosixPath(path).suffix.lower(), mimetypes.guess_type(path)[0] or "application/octet-stream")
    headers = {
        "Cache-Control": "private, immutable",
        "ETag": f'"{digest}"',
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    if path.endswith(".html"):
        headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; "
            "img-src 'self' blob:; object-src 'none'; base-uri 'none'"
        )
    return Response(content=payload, media_type=media_type, headers=headers)


@router.get("/builds", response_model=IoTBuildListV1, name="iot_build_list_v1")
async def list_builds_v1(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    principal: dict[str, Any] = Depends(require_scope("lvgl.build.read")),
):
    builds = [
        build_db.get_build(principal["ownerUserId"], item["id"], include_input=True)
        for item in build_db.list_builds(principal["ownerUserId"], limit)
    ]
    integration_db.record_access(principal, "build.list")
    return IoTBuildListV1(builds=[
        _dto(request, principal["ownerUserId"], item)
        for item in builds
        if item is not None
        and item.get("inputLock", {}).get("firmwareCapabilitySha256")
        and item.get("inputLock", {}).get("generator", {}).get("uiAbiVersion")
    ])


@router.get("/builds/{build_id}", response_model=IoTBuildV1, name="iot_build_get_v1")
async def get_build_v1(
    build_id: str,
    request: Request,
    principal: dict[str, Any] = Depends(require_scope("lvgl.build.read")),
):
    build = _build_or_404(principal, build_id)
    integration_db.record_access(principal, "build.read", build_id)
    return _dto(request, principal["ownerUserId"], build)


@router.get("/builds/{build_id}/manifest", name="iot_build_manifest_v1")
async def get_manifest_v1(
    build_id: str,
    principal: dict[str, Any] = Depends(require_scope("lvgl.build.read")),
):
    build = _build_or_404(principal, build_id)
    if build.get("manifest") is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "manifest-not-available", "message": "build manifest is not available"},
        )
    integration_db.record_access(principal, "manifest.read", build_id)
    manifest_bytes = json.dumps(
        build["manifest"], ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return JSONResponse(
        content=build["manifest"],
        headers={
            "Cache-Control": "private, immutable",
            "ETag": f'"{hashlib.sha256(manifest_bytes).hexdigest()}"',
        },
    )


@router.get("/builds/{build_id}/artifact", name="iot_build_artifact_v1")
async def get_artifact_v1(
    build_id: str,
    principal: dict[str, Any] = Depends(require_scope("lvgl.artifact.read")),
):
    _build_or_404(principal, build_id)
    artifact = build_db.get_artifact(principal["ownerUserId"], build_id)
    if artifact is None or not artifact["path"].is_file():
        raise HTTPException(
            status_code=404,
            detail={"code": "artifact-not-available", "message": "build artifact is not available"},
        )
    digest = hashlib.sha256(artifact["path"].read_bytes()).hexdigest()
    if digest != artifact["sha256"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "artifact-integrity-failed", "message": "stored artifact hash mismatch"},
        )
    integration_db.record_access(principal, "artifact.read", build_id)
    return FileResponse(
        artifact["path"], media_type="application/zip", filename=f"lvgl-ui-{build_id}.zip",
        headers={"ETag": f'"{artifact["sha256"]}"', "Cache-Control": "private, immutable"},
    )


@router.get("/builds/{build_id}/preview", name="iot_build_preview_v1")
async def get_preview_v1(
    build_id: str,
    principal: dict[str, Any] = Depends(require_scope("lvgl.preview.read")),
):
    build = _build_or_404(principal, build_id)
    payload, digest = _preview_member(principal, build, "index.html")
    integration_db.record_access(principal, "preview.read", build_id)
    return _preview_response(payload, digest, "index.html")


@router.get("/builds/{build_id}/preview/{preview_path:path}", name="iot_build_preview_file_v1")
async def get_preview_file_v1(
    build_id: str,
    preview_path: str,
    principal: dict[str, Any] = Depends(require_scope("lvgl.preview.read")),
):
    build = _build_or_404(principal, build_id)
    payload, digest = _preview_member(principal, build, preview_path)
    integration_db.record_access(principal, "preview.file.read", build_id)
    return _preview_response(payload, digest, preview_path)


@router.post("/exchanges", response_model=IoTExchangeResultV1, name="iot_exchange_create_v1")
async def create_exchange_v1(
    body: IoTExchangeV1,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=200),
    principal: dict[str, Any] = Depends(require_scope("lvgl.exchange.write")),
):
    _build_or_404(principal, body.uiBuildId)
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", idempotency_key):
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid-idempotency-key", "message": "Idempotency-Key contains unsupported characters"},
        )
    payload = body.model_dump(mode="json")
    try:
        record, created = integration_db.record_exchange(
            principal, idempotency_key, body.eventType, body.uiBuildId, payload,
        )
    except integration_db.IdempotencyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "idempotency-conflict", "message": str(exc)},
        ) from exc
    integration_db.record_access(principal, "exchange.create" if created else "exchange.retry", body.uiBuildId)
    return IoTExchangeResultV1(
        exchangeId=record["id"],
        duplicate=not created,
        eventType=record["eventType"],
        uiBuildId=record["uiBuildId"],
        createdAt=record["createdAt"],
    )


@router.get("/exchanges", response_model=IoTExchangeListV1, name="iot_exchange_list_v1")
async def list_exchanges_v1(
    limit: int = Query(100, ge=1, le=500),
    principal: dict[str, Any] = Depends(require_scope("lvgl.exchange.read")),
):
    records = integration_db.list_exchanges(principal["ownerUserId"], limit)
    integration_db.record_access(principal, "exchange.list")
    return IoTExchangeListV1(exchanges=[{
        "apiVersion": "iot.lvgl/v1",
        "exchangeId": record["id"],
        "eventType": record["eventType"],
        "uiBuildId": record["uiBuildId"],
        "payload": record["payload"],
        "createdAt": record["createdAt"],
    } for record in records])


@router.get("/openapi.json", include_in_schema=False, name="iot_openapi_v1")
async def openapi_v1(request: Request):
    prefix = "/api/integrations/iot/v1"
    routes = [
        route for route in request.app.routes
        if getattr(route, "path", "").startswith(prefix)
    ]
    document = get_openapi(
        title="LVGL IoT Integration API",
        version="1.0.0",
        description="Stable M2M contract. Browser cookies are not accepted.",
        routes=routes,
    )
    return JSONResponse(document, headers={"Cache-Control": "no-store"})

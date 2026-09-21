"""Versioned Profile and BuildTarget APIs for LVGL platform projects."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..tools.auth.security import AuthUser, require_permission
from ..tools.lvgl_catalog import db
from ..tools.lvgl_projects import db as project_db
from ..tools.lvgl_projects.validation import (
    ProjectDocumentValidationError,
    validate_catalog_document,
)


router = APIRouter()
db.init_db()

ProfileKind = Literal["display", "controller", "input", "firmware"]
PROFILE_DOCUMENT_KIND = {
    "display": "display-profile",
    "controller": "controller-profile",
    "input": "input-profile",
    "firmware": "firmware-profile",
}


class CatalogRevisionRequest(BaseModel):
    doc: dict


def _validated(doc: dict, expected_kind: str) -> dict:
    try:
        return validate_catalog_document(doc, expected_kind)
    except ProjectDocumentValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "lvgl-catalog-validation",
                "message": str(exc),
                "issues": exc.issues,
            },
        ) from exc


def _publish(owner_user_id: int, actor_user_id: int, doc: dict) -> JSONResponse:
    try:
        record, created = db.publish_revision(owner_user_id, actor_user_id, doc)
    except db.RevisionConflictError as exc:
        raise HTTPException(status_code=409, detail={"code": "revision-conflict", "message": str(exc)}) from exc
    except db.RevisionSequenceError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "revision-sequence",
                "message": str(exc),
                "expectedRevision": exc.expected,
                "actualRevision": exc.actual,
            },
        ) from exc
    except db.ReferenceNotFoundError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "catalog-reference-not-found",
                "message": str(exc),
                "reference": exc.reference,
            },
        ) from exc
    return JSONResponse(status_code=201 if created else 200, content={"created": created, **record})


@router.get("/themes")
async def list_themes(user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    return {"themes": db.list_latest(user["id"], "lvgl-theme")}


@router.post("/themes")
async def publish_theme(
    req: CatalogRevisionRequest,
    user: AuthUser = Depends(require_permission("tool.lvgl.profile.manage")),
):
    return _publish(user["id"], user["id"], _validated(req.doc, "lvgl-theme"))


@router.get("/themes/{theme_id}/revisions")
async def list_theme_revisions(
    theme_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    return {"revisions": db.list_revisions(user["id"], "lvgl-theme", theme_id)}


@router.get("/themes/{theme_id}/revisions/{revision}")
async def get_theme_revision(
    theme_id: str,
    revision: int,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    record = db.get_revision(user["id"], "lvgl-theme", theme_id, revision)
    if record is None:
        raise HTTPException(status_code=404, detail="theme revision not found")
    return record


@router.get("/profiles")
async def list_profiles(
    kind: ProfileKind | None = None,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    document_kind = PROFILE_DOCUMENT_KIND[kind] if kind is not None else None
    profiles = db.list_latest(user["id"], document_kind)
    if kind is None:
        profiles = [item for item in profiles if item["kind"] in db.PROFILE_KINDS]
    return {"profiles": profiles}


@router.post("/profiles/{profile_kind}")
async def publish_profile(
    profile_kind: ProfileKind,
    req: CatalogRevisionRequest,
    user: AuthUser = Depends(require_permission("tool.lvgl.profile.manage")),
):
    return _publish(user["id"], user["id"], _validated(req.doc, PROFILE_DOCUMENT_KIND[profile_kind]))


@router.get("/profiles/{profile_kind}/{profile_id}/revisions")
async def list_profile_revisions(
    profile_kind: ProfileKind,
    profile_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    return {"revisions": db.list_revisions(user["id"], PROFILE_DOCUMENT_KIND[profile_kind], profile_id)}


@router.get("/profiles/{profile_kind}/{profile_id}/revisions/{revision}")
async def get_profile_revision(
    profile_kind: ProfileKind,
    profile_id: str,
    revision: int,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    record = db.get_revision(user["id"], PROFILE_DOCUMENT_KIND[profile_kind], profile_id, revision)
    if record is None:
        raise HTTPException(status_code=404, detail="profile revision not found")
    return record


@router.get("/build-targets")
async def list_build_targets(user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    return {"buildTargets": db.list_latest(user["id"], "lvgl-build-target")}


@router.post("/build-targets")
async def publish_build_target(
    req: CatalogRevisionRequest,
    user: AuthUser = Depends(require_permission("tool.lvgl.profile.manage")),
):
    doc = _validated(req.doc, "lvgl-build-target")
    theme_ref = doc["themeRef"]
    embedded_theme = theme_ref.startswith(f"{doc['uiProjectRef']}#theme:")
    ui = project_db.resolve_ui_revision(
        user["id"], doc["uiProjectRef"], theme_ref if embedded_theme else None,
    )
    if ui is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "ui-revision-not-found",
                "message": "uiProjectRef/themeRef does not resolve to a retained project revision",
                "reference": doc["uiProjectRef"],
            },
        )
    if not embedded_theme and db.get_reference(user["id"], theme_ref) is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "theme-revision-not-found",
                "message": "standalone Theme revision does not exist for this owner",
                "reference": theme_ref,
            },
        )
    controller = db.get_reference(user["id"], doc["controllerProfileRef"])
    if controller is not None and ui.get("designDisplayRef") != controller["doc"].get("displayRef"):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "build-target-display-mismatch",
                "message": "UiProject and ControllerProfile must resolve to the same DisplayProfile revision",
            },
        )
    return _publish(user["id"], user["id"], doc)


@router.get("/build-targets/{target_id}/revisions")
async def list_build_target_revisions(
    target_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    return {"revisions": db.list_revisions(user["id"], "lvgl-build-target", target_id)}


@router.get("/build-targets/{target_id}/revisions/{revision}")
async def get_build_target_revision(
    target_id: str,
    revision: int,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    record = db.get_revision(user["id"], "lvgl-build-target", target_id, revision)
    if record is None:
        raise HTTPException(status_code=404, detail="build target revision not found")
    return record

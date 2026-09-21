"""Authenticated content-addressed asset APIs for LVGL projects."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from ..tools.auth.security import AuthUser, require_permission
from ..tools.lvgl_assets import store


router = APIRouter()
store.init_db()


def _error(exc: store.AssetStoreError) -> HTTPException:
    status = 413 if exc.code == "asset-too-large" else 422
    return HTTPException(
        status_code=status,
        detail={"code": exc.code, "message": str(exc), "reference": exc.reference},
    )


@router.get("")
@router.get("/")
async def list_assets(
    limit: int = Query(500, ge=1, le=2000),
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    return {"assets": store.list_assets(user["id"], limit)}


@router.put("/{sha256}")
async def put_asset(
    sha256: str,
    request: Request,
    fileName: str = Query(..., min_length=1, max_length=255),
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > store.MAX_ASSET_BYTES:
        raise HTTPException(status_code=413, detail={"code": "asset-too-large", "message": "asset exceeds size limit"})
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > store.MAX_ASSET_BYTES:
            raise HTTPException(status_code=413, detail={"code": "asset-too-large", "message": "asset exceeds size limit"})
        payload.extend(chunk)
    try:
        metadata, created = store.put_asset(
            user["id"], sha256, bytes(payload), fileName, request.headers.get("content-type"),
        )
    except store.AssetStoreError as exc:
        raise _error(exc) from exc
    metadata.pop("path", None)
    return JSONResponse(status_code=201 if created else 200, content=metadata)


@router.get("/{sha256}/meta")
async def get_asset_metadata(
    sha256: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    try:
        metadata = store.get_asset(user["id"], sha256)
    except store.AssetStoreError as exc:
        raise _error(exc) from exc
    if metadata is None:
        raise HTTPException(status_code=404, detail="asset not found")
    metadata.pop("path", None)
    return metadata


@router.get("/{sha256}")
async def get_asset(
    sha256: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    try:
        metadata, _payload = store.read_verified(user["id"], sha256)
    except store.AssetStoreError as exc:
        if exc.code == "asset-not-found":
            raise HTTPException(status_code=404, detail="asset not found") from exc
        raise _error(exc) from exc
    return FileResponse(
        metadata["path"],
        media_type=metadata["mimeType"],
        filename=metadata["fileName"],
        headers={
            "ETag": f'"{metadata["sha256"]}"',
            "Cache-Control": "private, immutable",
            "X-Asset-File-Name": quote(metadata["fileName"], safe=""),
            "X-Asset-Byte-Size": str(metadata["byteSize"]),
        },
    )

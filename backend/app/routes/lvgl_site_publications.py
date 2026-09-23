"""Authenticated ui.podsc.com prepare and publish APIs."""

from __future__ import annotations

import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field, field_validator

from ..tools.auth.security import AuthUser, require_permission
from ..tools.lvgl_site_publications import db, service


router = APIRouter()
db.init_db()


class PrepareRequest(BaseModel):
    requestId: str
    projectId: str = Field(..., min_length=1, max_length=160)
    frameId: str = Field(..., min_length=1, max_length=160)
    name: str = Field(..., min_length=1, max_length=160)
    description: str = Field("", max_length=1000)
    isPublic: bool | None = None
    demoId: str | None = None

    @field_validator("demoId")
    @classmethod
    def validate_demo_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError("demoId must be a UUID") from exc

    @field_validator("requestId")
    @classmethod
    def validate_request_id(cls, value: str) -> str:
        try:
            return str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError("requestId must be a UUID") from exc


def _error(exc: service.PublicationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code,
                         detail={"code": exc.code, "message": str(exc), "detail": exc.detail})


@router.get("/frames")
def get_frames(user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    try:
        return service.frames()
    except service.PublicationError as exc:
        raise _error(exc) from exc


@router.get("")
@router.get("/")
async def list_publications(
    projectId: str = Query(..., min_length=1, max_length=160),
    user: AuthUser = Depends(require_permission("tool.lvgl.publish")),
):
    return {"publications": service.list_for_project(user["id"], projectId)}


@router.post("/prepare")
def prepare_publication(request: PrepareRequest,
                        user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    try:
        return service.prepare(
            user["id"], user["id"], project_id=request.projectId, frame_id=request.frameId,
            name=request.name, description=request.description, is_public=request.isPublic,
            demo_id=request.demoId, request_id=request.requestId,
        )
    except service.PublicationError as exc:
        raise _error(exc) from exc


@router.get("/{publication_id}")
async def get_publication(publication_id: str,
                          user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    publication = service.get(user["id"], publication_id)
    if publication is None:
        raise HTTPException(status_code=404, detail="publication not found")
    return publication


@router.get("/{publication_id}/thumbnail")
async def get_thumbnail(publication_id: str,
                        user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    artifact = service.thumbnail(user["id"], publication_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="thumbnail not found")
    path, sha256 = artifact
    return FileResponse(path, media_type="image/png",
                        headers={"ETag": f'"{sha256}"', "Cache-Control": "private, immutable"})


@router.get("/{publication_id}/preview", response_class=HTMLResponse)
async def get_preview(publication_id: str,
                      user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    files = service.preview(user["id"], publication_id)
    if files is None:
        raise HTTPException(status_code=404, detail="prepared preview not found")
    document_path, renderer_path, styles_path = files
    document_b64 = base64.b64encode(document_path.read_bytes()).decode("ascii")
    renderer_b64 = base64.b64encode(renderer_path.read_bytes()).decode("ascii")
    styles_b64 = base64.b64encode(styles_path.read_bytes()).decode("ascii")
    html = f"""<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<style>html,body,#root{{margin:0;width:100%;height:100%;overflow:hidden;background:#f4f5f7}}</style></head><body><div id=\"root\"></div>
<script type=\"module\">const decode=value=>new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
const style=document.createElement('style');style.textContent=decode('{styles_b64}');document.head.append(style);
const source=decode('{renderer_b64}');const moduleUrl=URL.createObjectURL(new Blob([source],{{type:'text/javascript'}}));
const {{createWebUiRenderer}}=await import(moduleUrl);const ui=JSON.parse(decode('{document_b64}'));
globalThis.__renderer=createWebUiRenderer(document.querySelector('#root'),ui,{{interactive:true,deviceFrames:[],fitPadding:0,maxScale:2}});</script></body></html>"""
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.post("/{publication_id}/publish")
def publish_publication(publication_id: str,
                        user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    try:
        return service.publish(user["id"], user["id"], publication_id)
    except service.PublicationError as exc:
        raise _error(exc) from exc


@router.post("/{publication_id}/rollback")
def rollback_publication(publication_id: str,
                         user: AuthUser = Depends(require_permission("tool.lvgl.publish"))):
    try:
        return service.rollback(user["id"], user["id"], publication_id)
    except service.PublicationError as exc:
        raise _error(exc) from exc

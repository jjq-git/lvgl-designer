"""LVGL Designer project storage compatibility routes."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..tools.auth.security import AuthUser, require_permission
from ..tools.lvgl_projects import db
from ..tools.lvgl_projects.validation import (
    ProjectDocumentValidationError,
    validate_project_document,
)

router = APIRouter()
db.init_db()


class ProjectCreateRequest(BaseModel):
    name: str = Field("Untitled", max_length=160)
    doc: dict


class ProjectUpdateRequest(BaseModel):
    doc: dict
    baseVersion: int | None = None
    name: str | None = Field(default=None, max_length=160)


class RenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)


class VersionCreateRequest(BaseModel):
    note: str = Field("", max_length=300)


def _validated_doc(doc: dict) -> dict:
    try:
        return validate_project_document(doc)
    except ProjectDocumentValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "lvgl-project-validation",
                "message": str(exc),
                "issues": exc.issues,
            },
        ) from exc


@router.get("")
@router.get("/")
async def list_projects(user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    return {"projects": db.list_projects(user["id"])}


@router.post("")
@router.post("/")
async def create_project(req: ProjectCreateRequest, user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    return db.create_project(user["id"], req.name, _validated_doc(req.doc))


@router.get("/{project_id}")
async def get_project(project_id: str, user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    project = db.get_project(user["id"], project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return project


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    req: ProjectUpdateRequest,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    try:
        project = db.update_project(
            user["id"], project_id, _validated_doc(req.doc), req.name, req.baseVersion,
        )
    except db.VersionConflictError as exc:
        return JSONResponse(
            status_code=409,
            content={"error": "version conflict", "current": exc.current},
        )
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return project


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    if not db.delete_project(user["id"], project_id):
        raise HTTPException(status_code=404, detail="project not found")
    return {"success": True}


@router.post("/{project_id}/rename")
async def rename_project(
    project_id: str,
    req: RenameRequest,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    if not db.rename_project(user["id"], project_id, req.name):
        raise HTTPException(status_code=404, detail="project not found")
    return {"success": True}


@router.get("/{project_id}/versions")
async def list_versions(project_id: str, user: AuthUser = Depends(require_permission("tool.lvgl.use"))):
    if db.get_project(user["id"], project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return {"versions": db.list_versions(user["id"], project_id)}


@router.post("/{project_id}/versions")
async def create_version(
    project_id: str,
    req: VersionCreateRequest,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    version = db.create_version(user["id"], project_id, req.note)
    if version is None:
        raise HTTPException(status_code=404, detail="project not found")
    return version


@router.get("/{project_id}/versions/{version_id}")
async def get_version_doc(
    project_id: str,
    version_id: int,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    doc = db.get_version_doc(user["id"], project_id, version_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="version not found")
    return {"doc": doc}


@router.post("/{project_id}/restore/{version_id}")
async def restore_version(
    project_id: str,
    version_id: int,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    project = db.restore_version(user["id"], project_id, version_id)
    if project is None:
        raise HTTPException(status_code=404, detail="version not found")
    return project


@router.delete("/{project_id}/versions/{version_id}")
async def delete_version(
    project_id: str,
    version_id: int,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    result = db.delete_version(user["id"], project_id, version_id)
    if result == "not_found":
        raise HTTPException(status_code=404, detail="version not found")
    if result == "not_manual":
        raise HTTPException(status_code=400, detail="only manual versions can be deleted")
    return {"success": True}

"""Immutable LVGL Build, artifact, and release-state APIs."""

import hashlib

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from ..tools.auth.security import AuthUser, require_permission
from ..tools.lvgl_builds import db, runner, service


router = APIRouter()
db.init_db()


class BuildCreateRequest(BaseModel):
    buildTargetId: str = Field(..., min_length=1, max_length=160)
    buildTargetRevision: int = Field(..., ge=1)


def _state_error(exc: db.BuildStateError) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "build-state-conflict",
            "message": str(exc),
            "currentState": exc.current,
            "requestedState": exc.requested,
        },
    )


@router.get("")
@router.get("/")
async def list_builds(
    limit: int = 100,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    return {"builds": db.list_builds(user["id"], limit)}


@router.post("")
@router.post("/")
async def create_build(
    req: BuildCreateRequest,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_permission("tool.lvgl.build")),
):
    try:
        build = service.queue_build(
            user["id"], user["id"], req.buildTargetId, req.buildTargetRevision,
        )
    except service.BuildInputError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": exc.code, "message": str(exc), "reference": exc.reference},
        ) from exc
    background_tasks.add_task(runner.run_build, user["id"], build["id"])
    return JSONResponse(status_code=202, content=build)


@router.get("/{build_id}")
async def get_build(
    build_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    build = db.get_build(user["id"], build_id, include_input=True)
    if build is None:
        raise HTTPException(status_code=404, detail="build not found")
    return build


@router.get("/{build_id}/events")
async def get_build_events(
    build_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    if db.get_build(user["id"], build_id) is None:
        raise HTTPException(status_code=404, detail="build not found")
    return {"events": db.list_events(user["id"], build_id)}


@router.get("/{build_id}/artifact")
async def get_build_artifact(
    build_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    artifact = db.get_artifact(user["id"], build_id)
    if artifact is None or not artifact["path"].is_file():
        raise HTTPException(status_code=404, detail="artifact not found")
    actual_sha = hashlib.sha256(artifact["path"].read_bytes()).hexdigest()
    if actual_sha != artifact["sha256"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "artifact-integrity-failed", "message": "stored artifact hash mismatch"},
        )
    return FileResponse(
        artifact["path"],
        media_type="application/zip",
        filename=f"lvgl-ui-{build_id}.zip",
        headers={"ETag": f'"{artifact["sha256"]}"', "Cache-Control": "private, immutable"},
    )


@router.post("/{build_id}/approve")
async def approve_build(
    build_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.publish")),
):
    try:
        build = db.transition_build(user["id"], build_id, "approved", user["id"])
    except db.BuildStateError as exc:
        raise _state_error(exc) from exc
    except db.BuildApprovalError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    if build is None:
        raise HTTPException(status_code=404, detail="build not found")
    return build


@router.post("/{build_id}/publish")
async def publish_build(
    build_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.publish")),
):
    try:
        build = db.publish_build(user["id"], build_id, user["id"])
    except db.BuildStateError as exc:
        raise _state_error(exc) from exc
    if build is None:
        raise HTTPException(status_code=404, detail="build not found")
    return build


@router.post("/{build_id}/rollback")
async def rollback_build(
    build_id: str,
    user: AuthUser = Depends(require_permission("tool.lvgl.publish")),
):
    try:
        build = db.transition_build(user["id"], build_id, "rolled_back", user["id"])
    except db.BuildStateError as exc:
        raise _state_error(exc) from exc
    if build is None:
        raise HTTPException(status_code=404, detail="build not found")
    return build

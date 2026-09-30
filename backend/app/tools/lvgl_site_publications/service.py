"""Orchestration for immutable prepare and controlled Git publication."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from ..lvgl_projects import db as project_db
from . import db, git_target, worker


class PublicationError(RuntimeError):
    def __init__(self, code: str, message: str, detail: Any = None, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.detail = detail
        self.status_code = status_code


def _plan_fields(record: dict[str, Any]) -> dict[str, Any]:
    path = db.artifact_dir(record["id"]) / "plan.json"
    if not path.is_file():
        return {}
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        key: plan[key]
        for key in ("diagnostics", "diffStat", "changedPaths", "manifestChange")
        if key in plan
    }


DELIVERY_STAGES = ("staticUpload", "stalePageDeletion", "cdnRefresh")
DELIVERY_STATUSES = {"not_started", "running", "succeeded", "failed", "skipped"}


def _empty_delivery() -> dict[str, dict[str, Any]]:
    return {stage: {"status": "not_started"} for stage in DELIVERY_STAGES}


def _delivery(record: dict[str, Any]) -> dict[str, Any]:
    committed = bool(record.get("commitSha"))
    git_status = "rolled_back" if record["status"] == "rolled_back" else ("submitted" if committed else "not_started")
    active_commit = record.get("rollbackCommitSha") if record["status"] == "rolled_back" else record.get("commitSha")
    result = {
        "git": {"status": git_status, "commitSha": active_commit},
        **_empty_delivery(),
    }
    stored = record.get("delivery")
    if isinstance(stored, dict):
        for stage in DELIVERY_STAGES:
            value = stored.get(stage)
            if isinstance(value, dict) and value.get("status") in DELIVERY_STATUSES:
                result[stage] = value
    return result


def _deployment_status(delivery: dict[str, Any]) -> str:
    statuses = [delivery[stage]["status"] for stage in DELIVERY_STAGES]
    if "failed" in statuses:
        return "deployment_failed"
    if all(status == "succeeded" for status in statuses):
        return "deployed"
    if delivery["cdnRefresh"]["status"] == "skipped" and all(
        delivery[stage]["status"] == "succeeded" for stage in ("staticUpload", "stalePageDeletion")
    ):
        return "deployment_partial"
    if any(status in {"running", "succeeded"} for status in statuses):
        return "deploying"
    return "git_submitted"


def _decorate(record: dict[str, Any], *, include_events: bool = False) -> dict[str, Any]:
    artifact = db.artifact_dir(record["id"])
    preview_available = all((artifact / name).is_file() for name in ("document.json", "renderer.js", "styles.css"))
    delivery = _delivery(record)
    result = {
        **record, **_plan_fields(record), "delivery": delivery,
        "interactivePreviewAvailable": preview_available,
    }
    if record["status"] in {"git_committed", "rolled_back"}:
        result["deploymentStatus"] = _deployment_status(delivery)
    if record["status"] == "git_committed":
        result["previewUrl"] = f"{git_target.public_base_url()}/?preview={record['demoId']}"
    if include_events:
        result["events"] = db.events(record["ownerUserId"], record["id"])
    return result


def _source_hash(document: dict[str, Any]) -> str:
    encoded = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def frames() -> dict[str, Any]:
    try:
        return git_target.read_state()
    except git_target.TargetError as exc:
        raise PublicationError(exc.code, str(exc), exc.detail, 503) from exc


def prepare(
    owner_user_id: int,
    actor_user_id: int,
    *,
    project_id: str,
    frame_id: str,
    name: str,
    description: str,
    is_public: bool | None,
    demo_id: str | None,
    request_id: str | None = None,
) -> dict[str, Any]:
    if request_id is not None:
        previous_request = db.get_by_request_key(owner_user_id, request_id)
        if previous_request is not None:
            mismatch = (
                previous_request["projectId"] != project_id
                or previous_request["frameId"] != frame_id
                or previous_request["name"] != name.strip()
                or previous_request["description"] != description.strip()
                or (demo_id is not None and previous_request["demoId"] != demo_id)
                or (is_public is not None and previous_request["isPublic"] != bool(is_public))
            )
            if mismatch:
                raise PublicationError(
                    "idempotency-key-conflict", "同一 requestId 不能用于不同的发布参数", status_code=409,
                )
            if previous_request["status"] == "failed":
                error = previous_request.get("error") or {}
                raise PublicationError(
                    error.get("code", "prepare-failed"),
                    error.get("message", "publication preparation failed"),
                    error.get("detail"),
                )
            return _decorate(previous_request)
    try:
        target = git_target.read_state()
    except git_target.TargetError as exc:
        raise PublicationError(exc.code, str(exc), exc.detail, 503) from exc
    if frame_id not in {frame["id"] for frame in target["frames"]}:
        raise PublicationError("frame-not-found", f"目标提交不存在 frameId：{frame_id}")
    existing = next((item for item in target["demos"] if item["id"] == demo_id), None)
    if demo_id is not None and existing is None:
        raise PublicationError("demo-not-found", "指定的既有 Demo UUID 不存在", status_code=404)
    effective_public = bool(is_public) if is_public is not None else (
        bool(existing["isPublic"]) if existing is not None else False
    )
    locked = project_db.lock_project_version(owner_user_id, project_id, "ui.podsc.com 发布锁定")
    if locked is None:
        raise PublicationError("project-not-found", "cloud project not found", status_code=404)
    snapshot = locked["doc"]
    if snapshot.get("kind") != "lvgl-project-snapshot" or snapshot.get("snapshotVersion") != 1:
        raise PublicationError("snapshot-required", "项目必须先保存为 Schema v2 快照")
    ui_project = snapshot.get("uiProject") if isinstance(snapshot.get("uiProject"), dict) else {}
    ui_meta = ui_project.get("meta") if isinstance(ui_project.get("meta"), dict) else {}
    ui_revision = ui_meta.get("revision")
    if not isinstance(ui_revision, int) or ui_revision < 1:
        raise PublicationError("snapshot-invalid", "UI project revision is invalid")
    repository, branch = git_target.configuration()
    record, created = db.create(
        owner_user_id, actor_user_id, project_id=project_id, demo_id=demo_id, frame_id=frame_id,
        name=name.strip(), description=description.strip(), is_public=effective_public,
        source_project_version=locked["projectVersion"], source_snapshot_seq=locked["seq"],
        source_ui_revision=ui_revision, source_sha256=_source_hash(snapshot),
        target_repo=repository, target_branch=branch, request_key=request_id,
    )
    if not created:
        return _decorate(record)
    artifact_dir = db.artifact_dir(record["id"])
    try:
        projection = worker.project(snapshot)
        execution_record = {**record, "boundExisting": demo_id is not None}
        plan = git_target.prepare(execution_record, projection["json"], artifact_dir)
        prepared = db.transition(
            owner_user_id, actor_user_id, record["id"], "prepared",
            fields={
                "document_sha256": plan["documentSha256"],
                "thumbnail_sha256": plan["thumbnailSha256"],
                "target_base_commit": plan["targetBaseCommit"],
                "error_json": None,
            },
            detail={"changedPaths": plan["changedPaths"], "diagnostics": plan["diagnostics"]},
        )
        return _decorate(prepared)
    except worker.ProjectionError as exc:
        error = {"code": exc.code, "message": str(exc), "detail": exc.diagnostics}
        db.transition(owner_user_id, actor_user_id, record["id"], "failed", fields={"error_json": json.dumps(error, ensure_ascii=False)}, detail=error)
        raise PublicationError(exc.code, str(exc), exc.diagnostics) from exc
    except git_target.TargetError as exc:
        error = {"code": exc.code, "message": str(exc), "detail": exc.detail}
        db.transition(owner_user_id, actor_user_id, record["id"], "failed", fields={"error_json": json.dumps(error, ensure_ascii=False)}, detail=error)
        raise PublicationError(exc.code, str(exc), exc.detail, 409 if "conflict" in exc.code else 422) from exc


def publish(owner_user_id: int, actor_user_id: int, publication_id: str) -> dict[str, Any]:
    record = db.get(owner_user_id, publication_id)
    if record is None:
        raise PublicationError("publication-not-found", "publication not found", status_code=404)
    if record["status"] == "git_committed":
        return _decorate(record)
    retryable_failed = record["status"] == "failed" and (
        db.artifact_dir(publication_id) / "plan.json"
    ).is_file()
    if record["status"] not in {"prepared", "publishing", "conflict"} and not retryable_failed:
        raise PublicationError("publication-state-conflict", f"cannot publish from {record['status']}", status_code=409)
    current_project = project_db.get_project(owner_user_id, record["projectId"])
    if current_project is None or current_project["version"] != record["sourceProjectVersion"]:
        raise PublicationError(
            "prepared-source-expired",
            "工程在准备后已发生变化，请重新准备发布产物",
            {"preparedVersion": record["sourceProjectVersion"],
             "currentVersion": None if current_project is None else current_project["version"]},
            status_code=409,
        )
    db.transition(owner_user_id, actor_user_id, publication_id, "publishing")
    try:
        result = git_target.publish(record, db.artifact_dir(publication_id))
        committed = db.transition(
            owner_user_id, actor_user_id, publication_id, "git_committed",
            fields={
                "commit_sha": result["commitSha"], "published_at": db._now(),
                "delivery_json": json.dumps(_empty_delivery(), separators=(",", ":")), "error_json": None,
            },
            detail=result,
        )
        return _decorate(committed)
    except git_target.TargetError as exc:
        error = {"code": exc.code, "message": str(exc), "detail": exc.detail}
        status = "conflict" if exc.code in {"demo-conflict", "prepared-target-expired"} else "failed"
        db.transition(owner_user_id, actor_user_id, publication_id, status,
                      fields={"error_json": json.dumps(error, ensure_ascii=False)}, detail=error)
        raise PublicationError(exc.code, str(exc), exc.detail, 409 if status == "conflict" else 502) from exc


def rollback(owner_user_id: int, actor_user_id: int, publication_id: str) -> dict[str, Any]:
    record = db.get(owner_user_id, publication_id)
    if record is None:
        raise PublicationError("publication-not-found", "publication not found", status_code=404)
    if record["status"] == "rolled_back":
        return _decorate(record)
    if record["status"] not in {"git_committed", "rollback_failed"}:
        raise PublicationError("publication-state-conflict", "only a Git-committed publication can be rolled back", status_code=409)
    try:
        result = git_target.rollback(record, db.artifact_dir(publication_id))
        rolled_back = db.transition(
            owner_user_id, actor_user_id, publication_id, "rolled_back",
            fields={
                "rollback_commit_sha": result["commitSha"],
                "delivery_json": json.dumps(_empty_delivery(), separators=(",", ":")), "error_json": None,
            }, detail=result,
        )
        return _decorate(rolled_back)  # type: ignore[arg-type]
    except git_target.TargetError as exc:
        error = {"code": exc.code, "message": str(exc), "detail": exc.detail}
        db.transition(owner_user_id, actor_user_id, publication_id, "rollback_failed",
                      fields={"error_json": json.dumps(error, ensure_ascii=False)}, detail=error)
        raise PublicationError(exc.code, str(exc), exc.detail, 409 if exc.code == "demo-conflict" else 502) from exc


def get(owner_user_id: int, publication_id: str) -> dict[str, Any] | None:
    record = db.get(owner_user_id, publication_id)
    if record is None:
        return None
    return _decorate(record, include_events=True)


def list_for_project(owner_user_id: int, project_id: str) -> list[dict[str, Any]]:
    return [_decorate(record) for record in db.list_for_project(owner_user_id, project_id)]


def record_deployment(commit_sha: str, stage: str, status: str, detail: str = "") -> dict[str, Any]:
    if stage not in DELIVERY_STAGES or status not in DELIVERY_STATUSES:
        raise PublicationError("deployment-callback-invalid", "invalid deployment stage or status")
    record = db.get_by_commit(commit_sha)
    if record is None:
        raise PublicationError("publication-commit-not-found", "publication commit not found", status_code=404)
    active_commit = record.get("rollbackCommitSha") if record["status"] == "rolled_back" else record.get("commitSha")
    if active_commit != commit_sha:
        raise PublicationError(
            "publication-commit-superseded", "publication commit has been superseded", status_code=409,
        )
    delivery = record.get("delivery") if isinstance(record.get("delivery"), dict) else {}
    next_delivery = {**_empty_delivery(), **delivery}
    next_delivery[stage] = {"status": status, "detail": detail[:2000], "updatedAt": db._now()}
    updated = db.transition(
        record["ownerUserId"], record["ownerUserId"], record["id"], record["status"],
        fields={"delivery_json": json.dumps(next_delivery, ensure_ascii=False, separators=(",", ":"))},
        detail={"source": "target-deployment", "commitSha": commit_sha, "stage": stage,
                "status": status, "message": detail[:2000]},
    )
    if updated is None:
        raise PublicationError("publication-commit-not-found", "publication commit not found", status_code=404)
    return _decorate(updated, include_events=True)


def thumbnail(owner_user_id: int, publication_id: str) -> tuple[Path, str] | None:
    record = db.get(owner_user_id, publication_id)
    if record is None or record["status"] not in {"prepared", "publishing", "git_committed", "conflict"}:
        return None
    path = db.artifact_dir(publication_id) / "thumbnail.png"
    return (path, record["thumbnailSha256"]) if path.is_file() else None


def preview(owner_user_id: int, publication_id: str) -> tuple[Path, Path, Path] | None:
    record = db.get(owner_user_id, publication_id)
    if record is None or record["status"] not in {"prepared", "publishing", "git_committed", "conflict"}:
        return None
    artifact = db.artifact_dir(publication_id)
    files = artifact / "document.json", artifact / "renderer.js", artifact / "styles.css"
    return files if all(path.is_file() for path in files) else None

"""SQLite publication records, immutable prepared artifacts, and audit events."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from urllib.parse import urlsplit, urlunsplit
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DATA_DIR = Path(os.environ.get(
    "LVGL_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "lvgl_data"),
))
DB_PATH = DATA_DIR / "site_publications.db"
ARTIFACT_ROOT = DATA_DIR / "site_publications"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS site_publications (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL,
    request_key TEXT,
    project_id TEXT NOT NULL,
    demo_id TEXT NOT NULL,
    frame_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    source_project_version INTEGER NOT NULL,
    source_snapshot_seq INTEGER NOT NULL,
    source_ui_revision INTEGER NOT NULL,
    source_sha256 TEXT NOT NULL,
    document_sha256 TEXT,
    thumbnail_sha256 TEXT,
    target_repo TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    target_base_commit TEXT,
    status TEXT NOT NULL,
    commit_sha TEXT,
    rollback_commit_sha TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_publications_owner_project
    ON site_publications(owner_user_id, project_id, updated_at);
CREATE TABLE IF NOT EXISTS site_publication_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    publication_id TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (publication_id) REFERENCES site_publications(id) ON DELETE CASCADE
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = _connect()
    try:
        conn.executescript(_SCHEMA)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(site_publications)")}
        if "rollback_commit_sha" not in columns:
            conn.execute("ALTER TABLE site_publications ADD COLUMN rollback_commit_sha TEXT")
        if "request_key" not in columns:
            conn.execute("ALTER TABLE site_publications ADD COLUMN request_key TEXT")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_site_publications_owner_request "
            "ON site_publications(owner_user_id, request_key) WHERE request_key IS NOT NULL"
        )
        conn.commit()
    finally:
        conn.close()


def _decode(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _row(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["isPublic"] = bool(result.pop("is_public"))
    for old, new in (
        ("owner_user_id", "ownerUserId"), ("project_id", "projectId"), ("demo_id", "demoId"),
        ("request_key", "requestId"),
        ("frame_id", "frameId"), ("source_project_version", "sourceProjectVersion"),
        ("source_snapshot_seq", "sourceSnapshotSeq"), ("source_ui_revision", "sourceUiRevision"),
        ("source_sha256", "sourceSha256"), ("document_sha256", "documentSha256"),
        ("thumbnail_sha256", "thumbnailSha256"), ("target_repo", "targetRepo"),
        ("target_branch", "targetBranch"), ("target_base_commit", "targetBaseCommit"),
        ("commit_sha", "commitSha"), ("created_at", "createdAt"), ("updated_at", "updatedAt"),
        ("rollback_commit_sha", "rollbackCommitSha"),
        ("published_at", "publishedAt"),
    ):
        result[new] = result.pop(old)
    result["error"] = _decode(result.pop("error_json"), None)
    repository = result.get("targetRepo")
    if isinstance(repository, str) and "://" in repository:
        parsed = urlsplit(repository)
        host = parsed.hostname or "configured-target"
        if parsed.port is not None:
            host = f"{host}:{parsed.port}"
        result["targetRepo"] = urlunsplit((parsed.scheme, host, parsed.path, parsed.query, ""))
    return result


def create(
    owner_user_id: int,
    actor_user_id: int,
    *,
    project_id: str,
    demo_id: str | None,
    frame_id: str,
    name: str,
    description: str,
    is_public: bool,
    source_project_version: int,
    source_snapshot_seq: int,
    source_ui_revision: int,
    source_sha256: str,
    target_repo: str,
    target_branch: str,
    request_key: str | None = None,
) -> tuple[dict[str, Any], bool]:
    init_db()
    publication_id = str(uuid.uuid4())
    stable_demo_id = demo_id or str(uuid.uuid4())
    stamp = _now()
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if request_key is not None:
            existing = conn.execute(
                "SELECT * FROM site_publications WHERE owner_user_id = ? AND request_key = ?",
                (owner_user_id, request_key),
            ).fetchone()
            if existing is not None:
                conn.commit()
                return _row(existing), False
        conn.execute(
            """INSERT INTO site_publications (
                id, owner_user_id, request_key, project_id, demo_id, frame_id, name, description, is_public,
                source_project_version, source_snapshot_seq, source_ui_revision, source_sha256,
                target_repo, target_branch, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?)""",
            (publication_id, owner_user_id, request_key, project_id, stable_demo_id, frame_id, name, description,
             int(is_public), source_project_version, source_snapshot_seq, source_ui_revision,
             source_sha256, target_repo, target_branch, stamp, stamp),
        )
        conn.execute(
            "INSERT INTO site_publication_events (publication_id, owner_user_id, actor_user_id, event, created_at) VALUES (?, ?, ?, 'created', ?)",
            (publication_id, owner_user_id, actor_user_id, stamp),
        )
        conn.commit()
    finally:
        conn.close()
    return get(owner_user_id, publication_id), True  # type: ignore[return-value]


def get_by_request_key(owner_user_id: int, request_key: str) -> dict[str, Any] | None:
    init_db()
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM site_publications WHERE owner_user_id = ? AND request_key = ?",
            (owner_user_id, request_key),
        ).fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


def get(owner_user_id: int, publication_id: str) -> dict[str, Any] | None:
    init_db()
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM site_publications WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, publication_id),
        ).fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


def list_for_project(owner_user_id: int, project_id: str) -> list[dict[str, Any]]:
    init_db()
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM site_publications WHERE owner_user_id = ? AND project_id = ? ORDER BY updated_at DESC",
            (owner_user_id, project_id),
        ).fetchall()
        return [_row(row) for row in rows]
    finally:
        conn.close()


def transition(
    owner_user_id: int,
    actor_user_id: int,
    publication_id: str,
    status: str,
    *,
    fields: dict[str, Any] | None = None,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    allowed = {
        "document_sha256", "thumbnail_sha256", "target_base_commit", "commit_sha", "rollback_commit_sha", "error_json", "published_at",
    }
    values = fields or {}
    if not set(values).issubset(allowed):
        raise ValueError("unsupported publication field")
    stamp = _now()
    assignments = ["status = ?", "updated_at = ?", *[f"{key} = ?" for key in values]]
    parameters = [status, stamp, *values.values(), owner_user_id, publication_id]
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            f"UPDATE site_publications SET {', '.join(assignments)} WHERE owner_user_id = ? AND id = ?",
            parameters,
        )
        if cursor.rowcount == 0:
            return None
        conn.execute(
            """INSERT INTO site_publication_events
               (publication_id, owner_user_id, actor_user_id, event, detail_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (publication_id, owner_user_id, actor_user_id, status,
             json.dumps(detail or {}, ensure_ascii=False, separators=(",", ":")), stamp),
        )
        conn.commit()
    finally:
        conn.close()
    return get(owner_user_id, publication_id)


def events(owner_user_id: int, publication_id: str) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT actor_user_id, event, detail_json, created_at FROM site_publication_events
               WHERE owner_user_id = ? AND publication_id = ? ORDER BY seq""",
            (owner_user_id, publication_id),
        ).fetchall()
        return [{
            "actorUserId": row["actor_user_id"], "event": row["event"],
            "detail": _decode(row["detail_json"], {}), "createdAt": row["created_at"],
        } for row in rows]
    finally:
        conn.close()


def artifact_dir(publication_id: str) -> Path:
    if not str(uuid.UUID(publication_id)) == publication_id:
        raise ValueError("invalid publication id")
    return ARTIFACT_ROOT / publication_id

"""SQLite state machine and immutable artifact storage for LVGL UI builds."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping


DATA_DIR = Path(os.environ.get(
    "LVGL_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "lvgl_data"),
))
DB_PATH = DATA_DIR / "builds.db"
ARTIFACT_ROOT = DATA_DIR / "build_artifacts"
MAX_ARTIFACT_FILES = int(os.environ.get("LVGL_BUILD_MAX_FILES", "5000"))
MAX_ARTIFACT_BYTES = int(os.environ.get("LVGL_BUILD_MAX_BYTES", str(100 * 1024 * 1024)))
MAX_FILE_BYTES = int(os.environ.get("LVGL_BUILD_MAX_FILE_BYTES", str(25 * 1024 * 1024)))

BUILD_STATES = {
    "queued", "validating", "building", "succeeded", "failed",
    "approved", "published", "superseded", "rolled_back",
}
TRANSITIONS = {
    "queued": {"validating", "failed"},
    "validating": {"building", "failed"},
    "building": {"succeeded", "failed"},
    "succeeded": {"approved"},
    "approved": {"published"},
    "published": {"superseded", "rolled_back"},
    "failed": set(),
    "superseded": set(),
    "rolled_back": set(),
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL,
    build_target_id TEXT NOT NULL,
    build_target_revision INTEGER NOT NULL,
    state TEXT NOT NULL,
    input_lock TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    diagnostics TEXT NOT NULL DEFAULT '[]',
    manifest TEXT,
    artifact_id TEXT,
    failure_code TEXT,
    failure_message TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_builds_owner
ON builds(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS build_artifacts (
    id TEXT PRIMARY KEY,
    build_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    content_sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (build_id) REFERENCES builds(id)
);

CREATE TABLE IF NOT EXISTS build_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    build_id TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    actor_user_id INTEGER,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (build_id) REFERENCES builds(id)
);

CREATE INDEX IF NOT EXISTS idx_build_events_build
ON build_events(owner_user_id, build_id, seq);

CREATE TABLE IF NOT EXISTS build_leases (
    build_id TEXT PRIMARY KEY,
    owner_token TEXT NOT NULL,
    expires_at REAL NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (build_id) REFERENCES builds(id)
);
"""


class BuildStateError(Exception):
    def __init__(self, current: str, requested: str):
        super().__init__(f"cannot transition build from {current} to {requested}")
        self.current = current
        self.requested = requested


class BuildApprovalError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ArtifactValidationError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = _get_conn()
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def _decode(raw: str | None, fallback: Any) -> Any:
    if raw is None:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _build(row: sqlite3.Row, include_input: bool = False) -> dict[str, Any]:
    out = {
        "id": row["id"],
        "buildTargetRef": f"{row['build_target_id']}@{row['build_target_revision']}",
        "state": row["state"],
        "inputSha256": row["input_sha256"],
        "diagnostics": _decode(row["diagnostics"], []),
        "manifest": _decode(row["manifest"], None),
        "artifactId": row["artifact_id"],
        "failure": None if row["failure_code"] is None else {
            "code": row["failure_code"], "message": row["failure_message"],
        },
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if include_input:
        out["inputLock"] = _decode(row["input_lock"], {})
    return out


def _event(
    conn: sqlite3.Connection,
    build_id: str,
    owner_user_id: int,
    event_type: str,
    from_state: str | None,
    to_state: str | None,
    actor_user_id: int | None,
    detail: Mapping[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO build_events
            (build_id, owner_user_id, event_type, from_state, to_state, actor_user_id, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (build_id, owner_user_id, event_type, from_state, to_state, actor_user_id,
         _canonical(dict(detail or {})), _now()),
    )


def create_build(
    owner_user_id: int,
    created_by: int,
    build_target_id: str,
    build_target_revision: int,
    input_lock: dict[str, Any],
) -> dict[str, Any]:
    init_db()
    build_id = uuid.uuid4().hex
    encoded_input = _canonical(input_lock)
    input_sha = _sha256(encoded_input.encode("utf-8"))
    stamp = _now()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO builds
                (id, owner_user_id, build_target_id, build_target_revision, state,
                 input_lock, input_sha256, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
            """,
            (build_id, owner_user_id, build_target_id, build_target_revision,
             encoded_input, input_sha, created_by, stamp, stamp),
        )
        _event(conn, build_id, owner_user_id, "created", None, "queued", created_by)
        conn.commit()
        return get_build(owner_user_id, build_id, include_input=True)
    finally:
        conn.close()


def get_build(owner_user_id: int, build_id: str, include_input: bool = False) -> dict[str, Any] | None:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM builds WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, build_id),
        ).fetchone()
        return _build(row, include_input) if row is not None else None
    finally:
        conn.close()


def list_builds(owner_user_id: int, limit: int = 100) -> list[dict[str, Any]]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM builds WHERE owner_user_id = ?
            ORDER BY created_at DESC LIMIT ?
            """,
            (owner_user_id, max(1, min(limit, 500))),
        ).fetchall()
        return [_build(row) for row in rows]
    finally:
        conn.close()


def list_events(owner_user_id: int, build_id: str) -> list[dict[str, Any]]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM build_events
            WHERE owner_user_id = ? AND build_id = ? ORDER BY seq
            """,
            (owner_user_id, build_id),
        ).fetchall()
        return [{
            "seq": row["seq"], "type": row["event_type"],
            "fromState": row["from_state"], "toState": row["to_state"],
            "actorUserId": row["actor_user_id"],
            "detail": _decode(row["detail"], {}), "createdAt": row["created_at"],
        } for row in rows]
    finally:
        conn.close()


def acquire_build_lease(
    build_id: str,
    owner_token: str,
    ttl_seconds: float,
    now: float | None = None,
) -> bool:
    init_db()
    current = time.time() if now is None else float(now)
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT owner_token, expires_at FROM build_leases WHERE build_id = ?",
            (build_id,),
        ).fetchone()
        if row is not None and row["owner_token"] != owner_token and float(row["expires_at"]) > current:
            conn.rollback()
            return False
        conn.execute(
            """
            INSERT INTO build_leases (build_id, owner_token, expires_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(build_id) DO UPDATE SET owner_token = excluded.owner_token,
                expires_at = excluded.expires_at, updated_at = excluded.updated_at
            """,
            (build_id, owner_token, current + max(1.0, ttl_seconds), _now()),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def release_build_lease(build_id: str, owner_token: str) -> bool:
    init_db()
    conn = _get_conn()
    try:
        cursor = conn.execute(
            "DELETE FROM build_leases WHERE build_id = ? AND owner_token = ?",
            (build_id, owner_token),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def claim_next_build(
    owner_token: str,
    ttl_seconds: float,
    now: float | None = None,
) -> dict[str, Any] | None:
    """Atomically lease the oldest queued build across all owners."""

    init_db()
    current = time.time() if now is None else float(now)
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """
            SELECT b.id, b.owner_user_id FROM builds b
            LEFT JOIN build_leases l ON l.build_id = b.id AND l.expires_at > ?
            WHERE b.state = 'queued' AND l.build_id IS NULL
            ORDER BY b.created_at, b.id LIMIT 1
            """,
            (current,),
        ).fetchone()
        if row is None:
            conn.rollback()
            return None
        conn.execute(
            """
            INSERT INTO build_leases (build_id, owner_token, expires_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(build_id) DO UPDATE SET owner_token = excluded.owner_token,
                expires_at = excluded.expires_at, updated_at = excluded.updated_at
            """,
            (row["id"], owner_token, current + max(1.0, ttl_seconds), _now()),
        )
        conn.commit()
        return {"id": row["id"], "ownerUserId": row["owner_user_id"]}
    finally:
        conn.close()


def recover_abandoned_builds(now: float | None = None) -> int:
    """Fail in-progress builds whose worker lease expired; queued work remains retryable."""

    init_db()
    current = time.time() if now is None else float(now)
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute(
            """
            SELECT b.id, b.owner_user_id, b.state FROM builds b
            LEFT JOIN build_leases l ON l.build_id = b.id AND l.expires_at > ?
            WHERE b.state IN ('validating', 'building') AND l.build_id IS NULL
            """,
            (current,),
        ).fetchall()
        stamp = _now()
        for row in rows:
            conn.execute(
                """
                UPDATE builds SET state = 'failed', failure_code = 'worker-interrupted',
                    failure_message = 'worker lease expired before build completion', updated_at = ?
                WHERE id = ?
                """,
                (stamp, row["id"]),
            )
            _event(conn, row["id"], row["owner_user_id"], "recovered_as_failed",
                   row["state"], "failed", None, {"code": "worker-interrupted"})
        conn.execute("DELETE FROM build_leases WHERE expires_at <= ?", (current,))
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def transition_build(
    owner_user_id: int,
    build_id: str,
    to_state: str,
    actor_user_id: int | None,
    detail: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    if to_state not in BUILD_STATES:
        raise ValueError(f"unknown build state: {to_state}")
    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM builds WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, build_id),
        ).fetchone()
        if row is None:
            return None
        current = row["state"]
        if to_state not in TRANSITIONS[current]:
            raise BuildStateError(current, to_state)
        if to_state == "approved":
            manifest = _decode(row["manifest"], {})
            generator = manifest.get("generator", {}) if isinstance(manifest, dict) else {}
            validation = generator.get("compileValidation", {}) if isinstance(generator, dict) else {}
            if (
                not isinstance(validation, dict)
                or validation.get("status") != "passed"
                or validation.get("releaseQualified") is not True
            ):
                raise BuildApprovalError(
                    "compile-validation-required",
                    "build approval requires a release-qualified target compilation attestation",
                )
        stamp = _now()
        conn.execute(
            "UPDATE builds SET state = ?, updated_at = ? WHERE owner_user_id = ? AND id = ?",
            (to_state, stamp, owner_user_id, build_id),
        )
        _event(conn, build_id, owner_user_id, "state_changed", current, to_state, actor_user_id, detail)
        conn.commit()
        return get_build(owner_user_id, build_id)
    finally:
        conn.close()


def fail_build(
    owner_user_id: int,
    build_id: str,
    code: str,
    message: str,
    diagnostics: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM builds WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, build_id),
        ).fetchone()
        if row is None:
            return None
        current = row["state"]
        if "failed" not in TRANSITIONS[current]:
            raise BuildStateError(current, "failed")
        stamp = _now()
        conn.execute(
            """
            UPDATE builds SET state = 'failed', diagnostics = ?, failure_code = ?,
                failure_message = ?, updated_at = ?
            WHERE owner_user_id = ? AND id = ?
            """,
            (_canonical(diagnostics or []), code, message, stamp, owner_user_id, build_id),
        )
        _event(conn, build_id, owner_user_id, "failed", current, "failed", None, {"code": code})
        conn.commit()
        return get_build(owner_user_id, build_id)
    finally:
        conn.close()


def _safe_file(path: str, content: str | bytes) -> tuple[str, bytes]:
    if not isinstance(path, str) or not path or "\\" in path or "\x00" in path:
        raise ArtifactValidationError("artifact path must be a non-empty POSIX path")
    pure = PurePosixPath(path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ArtifactValidationError(f"unsafe artifact path: {path!r}")
    normalized = pure.as_posix()
    if len(normalized) > 512:
        raise ArtifactValidationError(f"artifact path is too long: {path!r}")
    data = content.encode("utf-8") if isinstance(content, str) else bytes(content)
    if len(data) > MAX_FILE_BYTES:
        raise ArtifactValidationError(f"artifact file exceeds size limit: {path!r}")
    return normalized, data


def _prepare_files(files: Mapping[str, str | bytes]) -> dict[str, bytes]:
    if len(files) > MAX_ARTIFACT_FILES:
        raise ArtifactValidationError("artifact file count exceeds limit")
    prepared: dict[str, bytes] = {}
    total = 0
    for path, content in files.items():
        normalized, data = _safe_file(path, content)
        if normalized in prepared:
            raise ArtifactValidationError(f"duplicate artifact path: {normalized!r}")
        prepared[normalized] = data
        total += len(data)
        if total > MAX_ARTIFACT_BYTES:
            raise ArtifactValidationError("artifact total size exceeds limit")
    return prepared


def complete_build(
    owner_user_id: int,
    build_id: str,
    files: Mapping[str, str | bytes],
    diagnostics: list[dict[str, Any]],
    generator_manifest: dict[str, Any],
) -> dict[str, Any] | None:
    """Seal worker output into a deterministic ZIP and transition building -> succeeded."""

    if any(item.get("severity") == "error" for item in diagnostics):
        raise ArtifactValidationError("build with error diagnostics cannot succeed")
    prepared = _prepare_files(files)
    prepared.pop("build-manifest.json", None)
    prepared.pop("diagnostics.json", None)

    init_db()
    conn = _get_conn()
    created_destination = False
    committed = False
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM builds WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, build_id),
        ).fetchone()
        if row is None:
            return None
        if row["state"] != "building":
            raise BuildStateError(row["state"], "succeeded")

        file_entries = [{"path": path, "byteSize": len(data), "sha256": _sha256(data)}
                        for path, data in sorted(prepared.items())]
        input_lock = _decode(row["input_lock"], {})
        profile_locks = input_lock.get("profiles", {}) if isinstance(input_lock, dict) else {}
        manifest = {
            "formatVersion": 1,
            "inputSha256": row["input_sha256"],
            "buildTargetRef": f"{row['build_target_id']}@{row['build_target_revision']}",
            "inputs": {
                "uiProjectRef": input_lock.get("buildTarget", {}).get("uiProjectRef"),
                "uiProjectSha256": input_lock.get("uiProjectSha256"),
                "actionRegistrySha256": input_lock.get("actionRegistrySha256"),
                "uiAbiVersion": input_lock.get("generator", {}).get("uiAbiVersion"),
                "firmwareCapabilitySha256": input_lock.get("firmwareCapabilitySha256"),
                "assets": [
                    {
                        "category": asset.get("category"),
                        "id": asset.get("id"),
                        "sha256": asset.get("sha256"),
                        "byteSize": asset.get("byteSize"),
                    }
                    for asset in input_lock.get("assets", [])
                    if isinstance(asset, dict)
                ],
                "profiles": {
                    name: None if record is None else {
                        "ref": record.get("ref"), "sha256": record.get("sha256"),
                    }
                    for name, record in profile_locks.items()
                },
            },
            "generator": generator_manifest,
            "files": file_entries,
        }
        prepared["build-manifest.json"] = f"{json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2)}\n".encode("utf-8")
        prepared["diagnostics.json"] = f"{json.dumps(diagnostics, ensure_ascii=False, sort_keys=True, indent=2)}\n".encode("utf-8")

        artifact_id = uuid.uuid4().hex
        relative = PurePosixPath(str(owner_user_id), build_id, f"{artifact_id}.zip")
        destination = ARTIFACT_ROOT.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise ArtifactValidationError("artifact destination already exists")
        with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path, data in sorted(prepared.items()):
                info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        created_destination = True
        artifact_bytes = destination.read_bytes()
        stamp = _now()
        conn.execute(
            """
            INSERT INTO build_artifacts
                (id, build_id, owner_user_id, content_sha256, byte_size, file_count, storage_path, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (artifact_id, build_id, owner_user_id, _sha256(artifact_bytes), len(artifact_bytes),
             len(prepared), relative.as_posix(), stamp),
        )
        conn.execute(
            """
            UPDATE builds SET state = 'succeeded', diagnostics = ?, manifest = ?, artifact_id = ?, updated_at = ?
            WHERE owner_user_id = ? AND id = ?
            """,
            (_canonical(diagnostics), _canonical(manifest), artifact_id, stamp, owner_user_id, build_id),
        )
        _event(conn, build_id, owner_user_id, "artifact_sealed", "building", "succeeded", None,
               {"artifactId": artifact_id, "sha256": _sha256(artifact_bytes)})
        conn.commit()
        committed = True
        return get_build(owner_user_id, build_id)
    except Exception:
        if created_destination and not committed and destination.exists():
            destination.unlink()
        raise
    finally:
        conn.close()


def get_artifact(owner_user_id: int, build_id: str) -> dict[str, Any] | None:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT * FROM build_artifacts WHERE owner_user_id = ? AND build_id = ?
            """,
            (owner_user_id, build_id),
        ).fetchone()
        if row is None:
            return None
        root = ARTIFACT_ROOT.resolve()
        path = root.joinpath(*PurePosixPath(row["storage_path"]).parts).resolve()
        if not path.is_relative_to(root):
            raise ArtifactValidationError("artifact storage path escaped configured root")
        return {
            "id": row["id"], "buildId": row["build_id"],
            "sha256": row["content_sha256"], "byteSize": row["byte_size"],
            "fileCount": row["file_count"], "createdAt": row["created_at"],
            "path": path,
        }
    finally:
        conn.close()


def publish_build(owner_user_id: int, build_id: str, actor_user_id: int) -> dict[str, Any] | None:
    """Publish an approved build and supersede the prior build for the same target id."""

    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM builds WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, build_id),
        ).fetchone()
        if row is None:
            return None
        if row["state"] != "approved":
            raise BuildStateError(row["state"], "published")
        prior = conn.execute(
            """
            SELECT id FROM builds
            WHERE owner_user_id = ? AND build_target_id = ? AND state = 'published' AND id <> ?
            """,
            (owner_user_id, row["build_target_id"], build_id),
        ).fetchall()
        stamp = _now()
        for old in prior:
            conn.execute("UPDATE builds SET state = 'superseded', updated_at = ? WHERE id = ?", (stamp, old["id"]))
            _event(conn, old["id"], owner_user_id, "superseded", "published", "superseded",
                   actor_user_id, {"byBuildId": build_id})
        conn.execute("UPDATE builds SET state = 'published', updated_at = ? WHERE id = ?", (stamp, build_id))
        _event(conn, build_id, owner_user_id, "published", "approved", "published", actor_user_id)
        conn.commit()
        return get_build(owner_user_id, build_id)
    finally:
        conn.close()

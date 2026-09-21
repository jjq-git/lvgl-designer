"""Owner-scoped metadata over a shared, immutable SHA-256 blob store."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DATA_DIR = Path(os.environ.get(
    "LVGL_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "lvgl_data"),
))
DB_PATH = DATA_DIR / "assets.db"
BLOB_ROOT = DATA_DIR / "asset_blobs"
MAX_ASSET_BYTES = int(os.environ.get("LVGL_ASSET_MAX_BYTES", str(32 * 1024 * 1024)))
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS asset_objects (
    sha256 TEXT PRIMARY KEY,
    byte_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_owners (
    owner_user_id INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_user_id, sha256),
    FOREIGN KEY (sha256) REFERENCES asset_objects(sha256)
);

CREATE INDEX IF NOT EXISTS idx_asset_owners_updated
ON asset_owners(owner_user_id, updated_at DESC);
"""


class AssetStoreError(ValueError):
    def __init__(self, code: str, message: str, reference: str | None = None):
        super().__init__(message)
        self.code = code
        self.reference = reference


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _validate_sha256(value: str) -> str:
    normalized = value.strip().lower()
    if not SHA256_RE.fullmatch(normalized):
        raise AssetStoreError("invalid-asset-sha256", "asset SHA-256 must contain 64 lowercase hex characters")
    return normalized


def _safe_file_name(value: str) -> str:
    name = value.strip()
    if (
        not name or len(name) > 255 or name in {".", ".."}
        or "/" in name or "\\" in name or "\x00" in name
        or any(ord(char) < 32 for char in name)
    ):
        raise AssetStoreError("invalid-asset-file-name", "asset fileName must be a plain file name")
    return name


def _safe_mime_type(value: str | None) -> str:
    mime = (value or "application/octet-stream").split(";", 1)[0].strip().lower()
    if not mime or len(mime) > 120 or "/" not in mime or any(ord(char) < 32 for char in mime):
        raise AssetStoreError("invalid-asset-mime", "asset Content-Type is invalid")
    return mime


def _relative_path(sha256: str) -> str:
    return f"{sha256[:2]}/{sha256[2:4]}/{sha256}"


def _resolved_path(relative: str) -> Path:
    root = BLOB_ROOT.resolve()
    path = root.joinpath(*relative.split("/")).resolve()
    if not path.is_relative_to(root):
        raise AssetStoreError("asset-storage-path", "asset storage path escaped configured root")
    return path


def put_asset(
    owner_user_id: int,
    expected_sha256: str,
    data: bytes,
    file_name: str,
    mime_type: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Verify and store a blob; identical bytes are physically stored once."""

    sha256 = _validate_sha256(expected_sha256)
    name = _safe_file_name(file_name)
    mime = _safe_mime_type(mime_type)
    payload = bytes(data)
    if len(payload) > MAX_ASSET_BYTES:
        raise AssetStoreError("asset-too-large", f"asset exceeds {MAX_ASSET_BYTES} byte limit", sha256)
    actual = hashlib.sha256(payload).hexdigest()
    if actual != sha256:
        raise AssetStoreError("asset-sha256-mismatch", "uploaded bytes do not match URL SHA-256", sha256)

    init_db()
    relative = _relative_path(sha256)
    destination = _resolved_path(relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    created_object = False
    if not destination.exists():
        temporary = destination.with_name(f".{sha256}.{uuid.uuid4().hex}.part")
        try:
            temporary.write_bytes(payload)
            temporary.replace(destination)
            created_object = True
        finally:
            if temporary.exists():
                temporary.unlink()
    elif destination.stat().st_size != len(payload) or hashlib.sha256(destination.read_bytes()).hexdigest() != sha256:
        raise AssetStoreError("asset-integrity-failed", "existing CAS object failed integrity validation", sha256)

    stamp = _now()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT 1 FROM asset_owners WHERE owner_user_id = ? AND sha256 = ?",
            (owner_user_id, sha256),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO asset_objects (sha256, byte_size, storage_path, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(sha256) DO UPDATE SET
                byte_size = excluded.byte_size, storage_path = excluded.storage_path
            """,
            (sha256, len(payload), relative, stamp),
        )
        conn.execute(
            """
            INSERT INTO asset_owners
                (owner_user_id, sha256, file_name, mime_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(owner_user_id, sha256) DO UPDATE SET
                file_name = excluded.file_name, mime_type = excluded.mime_type,
                updated_at = excluded.updated_at
            """,
            (owner_user_id, sha256, name, mime, stamp, stamp),
        )
        conn.commit()
        metadata = get_asset(owner_user_id, sha256)
        assert metadata is not None
        return metadata, existing is None
    except Exception:
        conn.rollback()
        if created_object:
            # Keep a valid unreferenced CAS object: a concurrent owner may already
            # have registered it, and later uploads can safely reuse it.
            pass
        raise
    finally:
        conn.close()


def _asset(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "sha256": row["sha256"],
        "byteSize": row["byte_size"],
        "fileName": row["file_name"],
        "mimeType": row["mime_type"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_asset(owner_user_id: int, sha256: str) -> dict[str, Any] | None:
    sha256 = _validate_sha256(sha256)
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT o.sha256, o.byte_size, g.file_name, g.mime_type,
                   g.created_at, g.updated_at, o.storage_path
            FROM asset_objects o JOIN asset_owners g ON g.sha256 = o.sha256
            WHERE g.owner_user_id = ? AND o.sha256 = ?
            """,
            (owner_user_id, sha256),
        ).fetchone()
        if row is None:
            return None
        result = _asset(row)
        result["path"] = _resolved_path(row["storage_path"])
        return result
    finally:
        conn.close()


def list_assets(owner_user_id: int, limit: int = 500) -> list[dict[str, Any]]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT o.sha256, o.byte_size, g.file_name, g.mime_type,
                   g.created_at, g.updated_at
            FROM asset_objects o JOIN asset_owners g ON g.sha256 = o.sha256
            WHERE g.owner_user_id = ? ORDER BY g.updated_at DESC, o.sha256 LIMIT ?
            """,
            (owner_user_id, max(1, min(int(limit), 2000))),
        ).fetchall()
        return [_asset(row) for row in rows]
    finally:
        conn.close()


def read_verified(owner_user_id: int, sha256: str, expected_size: int | None = None) -> tuple[dict[str, Any], bytes]:
    metadata = get_asset(owner_user_id, sha256)
    if metadata is None:
        raise AssetStoreError("asset-not-found", f"asset is not present in server CAS: {sha256}", sha256)
    path = metadata["path"]
    if not path.is_file():
        raise AssetStoreError("asset-blob-missing", f"asset blob is missing: {sha256}", sha256)
    payload = path.read_bytes()
    if expected_size is not None and len(payload) != expected_size:
        raise AssetStoreError("asset-size-mismatch", f"asset byteSize does not match CAS: {sha256}", sha256)
    if len(payload) != metadata["byteSize"] or hashlib.sha256(payload).hexdigest() != metadata["sha256"]:
        raise AssetStoreError("asset-integrity-failed", f"asset failed CAS integrity check: {sha256}", sha256)
    return metadata, payload


def project_asset_entries(ui_project: dict[str, Any]) -> list[dict[str, Any]]:
    assets = ui_project.get("assets", {})
    locked: list[dict[str, Any]] = []
    for category in ("fonts", "images", "icons"):
        entries = assets.get(category, []) if isinstance(assets, dict) else []
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict) or not isinstance(entry.get("file"), dict):
                continue
            file = entry["file"]
            locked.append({
                "category": category,
                "id": entry.get("id"),
                "codeName": entry.get("codeName"),
                "displayName": entry.get("displayName"),
                "fileName": file.get("fileName"),
                "sha256": file.get("sha256"),
                "byteSize": file.get("byteSize"),
                "conv": entry.get("conv", {}),
            })
    return locked


def lock_project_assets(owner_user_id: int, ui_project: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate every project asset against CAS and return deterministic locks."""

    locked = project_asset_entries(ui_project)
    seen: set[str] = set()
    for entry in locked:
        sha256 = entry.get("sha256")
        byte_size = entry.get("byteSize")
        if not isinstance(sha256, str) or not isinstance(byte_size, int) or byte_size < 0:
            raise AssetStoreError("invalid-asset-reference", f"invalid asset file reference: {entry.get('id')}")
        read_verified(owner_user_id, sha256, byte_size)
        key = f"{entry.get('category')}:{entry.get('id')}"
        if key in seen:
            raise AssetStoreError("duplicate-asset-id", f"duplicate project asset id: {entry.get('id')}")
        seen.add(key)
    return sorted(locked, key=lambda item: (str(item["category"]), str(item["id"]), str(item["sha256"])))


def verify_asset_locks(owner_user_id: int, locks: Iterable[dict[str, Any]]) -> None:
    for entry in locks:
        read_verified(owner_user_id, str(entry.get("sha256", "")), entry.get("byteSize"))

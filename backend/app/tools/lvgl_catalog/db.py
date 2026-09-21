"""Owner-scoped immutable revision storage for LVGL catalogue objects."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DATA_DIR = Path(os.environ.get(
    "LVGL_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "lvgl_data"),
))
DB_PATH = DATA_DIR / "catalog.db"

PROFILE_KINDS = {
    "display-profile",
    "controller-profile",
    "input-profile",
    "firmware-profile",
}
CATALOG_KINDS = PROFILE_KINDS | {"lvgl-theme", "lvgl-build-target"}
REF_RE = re.compile(r"^(display|controller|input|firmware|theme):[a-z0-9][a-z0-9._-]*@([1-9]\d*)$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS catalog_revisions (
    owner_user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    doc TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_user_id, kind, object_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_catalog_latest
ON catalog_revisions(owner_user_id, kind, object_id, revision DESC);
"""


class RevisionConflictError(Exception):
    """The requested immutable revision already exists with different content."""


class RevisionSequenceError(Exception):
    def __init__(self, expected: int, actual: int):
        super().__init__(f"revision must be {expected}, got {actual}")
        self.expected = expected
        self.actual = actual


class ReferenceNotFoundError(Exception):
    def __init__(self, reference: str):
        super().__init__(f"referenced revision not found: {reference}")
        self.reference = reference


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    conn = _get_conn()
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def _encode(doc: dict[str, Any]) -> str:
    return json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _record(row: sqlite3.Row, include_doc: bool = True) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kind": row["kind"],
        "id": row["object_id"],
        "revision": row["revision"],
        "sha256": row["content_sha256"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
    }
    if include_doc:
        out["doc"] = json.loads(row["doc"])
    return out


def _ref_parts(reference: str) -> tuple[str, str, int] | None:
    match = REF_RE.fullmatch(reference)
    if match is None:
        return None
    ref_kind, raw_revision = match.groups()
    kind = "lvgl-theme" if ref_kind == "theme" else f"{ref_kind}-profile"
    return kind, reference.rsplit("@", 1)[0], int(raw_revision)


def _reference_exists(conn: sqlite3.Connection, owner_user_id: int, reference: str) -> bool:
    parts = _ref_parts(reference)
    if parts is None:
        return False
    kind, object_id, revision = parts
    return conn.execute(
        """
        SELECT 1 FROM catalog_revisions
        WHERE owner_user_id = ? AND kind = ? AND object_id = ? AND revision = ?
        """,
        (owner_user_id, kind, object_id, revision),
    ).fetchone() is not None


def _check_references(conn: sqlite3.Connection, owner_user_id: int, doc: dict[str, Any]) -> None:
    references: list[str] = []
    if doc["kind"] == "controller-profile":
        references.append(doc["displayRef"])
        if doc.get("inputProfileRef"):
            references.append(doc["inputProfileRef"])
    elif doc["kind"] == "lvgl-build-target":
        references.append(doc["controllerProfileRef"])
        if doc.get("firmwareProfileRef"):
            references.append(doc["firmwareProfileRef"])
        if str(doc.get("themeRef", "")).startswith("theme:"):
            references.append(doc["themeRef"])
    elif doc["kind"] == "lvgl-theme" and doc.get("extends"):
        references.append(doc["extends"])
    for reference in references:
        if not _reference_exists(conn, owner_user_id, reference):
            raise ReferenceNotFoundError(reference)


def publish_revision(
    owner_user_id: int,
    created_by: int,
    doc: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """Append one revision; identical retries are idempotent, overwrites are rejected."""

    kind = str(doc["kind"])
    if kind not in CATALOG_KINDS:
        raise ValueError(f"unsupported catalog kind: {kind}")
    object_id = str(doc["id"])
    revision = int(doc["revision"])
    encoded = _encode(doc)
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            """
            SELECT * FROM catalog_revisions
            WHERE owner_user_id = ? AND kind = ? AND object_id = ? AND revision = ?
            """,
            (owner_user_id, kind, object_id, revision),
        ).fetchone()
        if existing is not None:
            if existing["content_sha256"] == digest and existing["doc"] == encoded:
                conn.rollback()
                return _record(existing), False
            raise RevisionConflictError(f"{object_id}@{revision} already exists")

        latest = conn.execute(
            """
            SELECT COALESCE(MAX(revision), 0) AS revision
            FROM catalog_revisions
            WHERE owner_user_id = ? AND kind = ? AND object_id = ?
            """,
            (owner_user_id, kind, object_id),
        ).fetchone()
        expected = int(latest["revision"]) + 1
        if revision != expected:
            raise RevisionSequenceError(expected, revision)

        _check_references(conn, owner_user_id, doc)
        stamp = _now()
        conn.execute(
            """
            INSERT INTO catalog_revisions
                (owner_user_id, kind, object_id, revision, doc, content_sha256, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (owner_user_id, kind, object_id, revision, encoded, digest, created_by, stamp),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT * FROM catalog_revisions
            WHERE owner_user_id = ? AND kind = ? AND object_id = ? AND revision = ?
            """,
            (owner_user_id, kind, object_id, revision),
        ).fetchone()
        return _record(row), True
    finally:
        conn.close()


def list_latest(owner_user_id: int, kind: str | None = None) -> list[dict[str, Any]]:
    init_db()
    conn = _get_conn()
    try:
        params: list[Any] = [owner_user_id]
        kind_clause = ""
        if kind is not None:
            kind_clause = "AND r.kind = ?"
            params.append(kind)
        rows = conn.execute(
            f"""
            SELECT r.* FROM catalog_revisions r
            WHERE r.owner_user_id = ? {kind_clause}
              AND r.revision = (
                SELECT MAX(x.revision) FROM catalog_revisions x
                WHERE x.owner_user_id = r.owner_user_id
                  AND x.kind = r.kind AND x.object_id = r.object_id
              )
            ORDER BY r.kind, r.object_id
            """,
            params,
        ).fetchall()
        return [_record(row) for row in rows]
    finally:
        conn.close()


def list_revisions(owner_user_id: int, kind: str, object_id: str) -> list[dict[str, Any]]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM catalog_revisions
            WHERE owner_user_id = ? AND kind = ? AND object_id = ?
            ORDER BY revision DESC
            """,
            (owner_user_id, kind, object_id),
        ).fetchall()
        return [_record(row, include_doc=False) for row in rows]
    finally:
        conn.close()


def get_revision(
    owner_user_id: int,
    kind: str,
    object_id: str,
    revision: int,
) -> dict[str, Any] | None:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT * FROM catalog_revisions
            WHERE owner_user_id = ? AND kind = ? AND object_id = ? AND revision = ?
            """,
            (owner_user_id, kind, object_id, revision),
        ).fetchone()
        return _record(row) if row is not None else None
    finally:
        conn.close()


def get_reference(owner_user_id: int, reference: str) -> dict[str, Any] | None:
    """Resolve a typed Profile reference such as ``controller:panel@2``."""

    parts = _ref_parts(reference)
    if parts is None:
        return None
    kind, object_id, revision = parts
    return get_revision(owner_user_id, kind, object_id, revision)

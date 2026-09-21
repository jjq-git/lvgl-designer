"""SQLite storage for LVGL Designer cloud-project compatible APIs."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(os.environ.get(
    "LVGL_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "lvgl_data"),
))
DB_PATH = DATA_DIR / "projects.db"
AUTO_KEEP = 30
AUTO_MERGE_WINDOW = timedelta(seconds=60)


class VersionConflictError(Exception):
    def __init__(self, current: int):
        super().__init__(f"version conflict: current={current}")
        self.current = current

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    doc TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS project_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    seq INTEGER,
    kind TEXT NOT NULL DEFAULT 'manual',
    note TEXT NOT NULL DEFAULT '',
    doc TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_versions_project ON project_versions(project_id, created_at);
"""


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
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(project_versions)")}
        if "seq" not in columns:
            conn.execute("ALTER TABLE project_versions ADD COLUMN seq INTEGER")
        if "kind" not in columns:
            conn.execute("ALTER TABLE project_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'")
        project_ids = conn.execute(
            "SELECT DISTINCT project_id FROM project_versions WHERE seq IS NULL"
        ).fetchall()
        for project_row in project_ids:
            rows = conn.execute(
                "SELECT id FROM project_versions WHERE project_id = ? ORDER BY created_at, id",
                (project_row["project_id"],),
            ).fetchall()
            for seq, row in enumerate(rows, start=1):
                conn.execute("UPDATE project_versions SET seq = ? WHERE id = ?", (seq, row["id"]))
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_project_versions_seq "
            "ON project_versions(project_id, seq)"
        )
        conn.commit()
    finally:
        conn.close()


def _encode_doc(doc: dict) -> str:
    return json.dumps(doc or {}, ensure_ascii=False, separators=(",", ":"))


def _decode_doc(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _project(row: sqlite3.Row, include_doc: bool = True) -> dict:
    out = {
        "id": row["id"],
        "name": row["name"],
        "version": row["version"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if include_doc:
        out["doc"] = _decode_doc(row["doc"])
    return out


def list_projects(owner_user_id: int) -> list[dict]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM projects
            WHERE owner_user_id = ?
            ORDER BY updated_at DESC
            """,
            (owner_user_id,),
        ).fetchall()
        return [_project(row, include_doc=False) for row in rows]
    finally:
        conn.close()


def create_project(owner_user_id: int, name: str, doc: dict) -> dict:
    init_db()
    project_id = uuid.uuid4().hex
    stamp = _now()
    conn = _get_conn()
    try:
        conn.execute(
            """
            INSERT INTO projects (id, owner_user_id, name, doc, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (project_id, owner_user_id, name.strip() or "Untitled", _encode_doc(doc), stamp, stamp),
        )
        conn.commit()
        return get_project(owner_user_id, project_id)
    finally:
        conn.close()


def get_project(owner_user_id: int, project_id: str) -> dict | None:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM projects WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, project_id),
        ).fetchone()
        return _project(row) if row else None
    finally:
        conn.close()


def _next_seq(conn: sqlite3.Connection, project_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM project_versions WHERE project_id = ?",
        (project_id,),
    ).fetchone()
    return int(row["max_seq"]) + 1


def _record_auto_snapshot(
    conn: sqlite3.Connection,
    owner_user_id: int,
    project_id: str,
    doc: dict,
    project_version: int,
    stamp: str,
) -> None:
    latest = conn.execute(
        """
        SELECT id, created_at FROM project_versions
        WHERE owner_user_id = ? AND project_id = ? AND kind = 'auto'
        ORDER BY created_at DESC LIMIT 1
        """,
        (owner_user_id, project_id),
    ).fetchone()
    merge = False
    if latest:
        try:
            merge = datetime.fromisoformat(latest["created_at"]) >= datetime.now(timezone.utc) - AUTO_MERGE_WINDOW
        except (TypeError, ValueError):
            merge = False
    if merge:
        conn.execute(
            "UPDATE project_versions SET doc = ?, version = ?, created_at = ? WHERE id = ?",
            (_encode_doc(doc), project_version, stamp, latest["id"]),
        )
    else:
        conn.execute(
            """
            INSERT INTO project_versions
                (id, project_id, owner_user_id, version, seq, kind, note, doc, created_at)
            VALUES (?, ?, ?, ?, ?, 'auto', '', ?, ?)
            """,
            (
                uuid.uuid4().hex,
                project_id,
                owner_user_id,
                project_version,
                _next_seq(conn, project_id),
                _encode_doc(doc),
                stamp,
            ),
        )
        stale = conn.execute(
            """
            SELECT id FROM project_versions
            WHERE owner_user_id = ? AND project_id = ? AND kind = 'auto'
            ORDER BY created_at DESC LIMIT -1 OFFSET ?
            """,
            (owner_user_id, project_id, AUTO_KEEP),
        ).fetchall()
        if stale:
            conn.executemany("DELETE FROM project_versions WHERE id = ?", [(row["id"],) for row in stale])


def update_project(
    owner_user_id: int,
    project_id: str,
    doc: dict,
    name: str | None = None,
    base_version: int | None = None,
) -> dict | None:
    init_db()
    stamp = _now()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM projects WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, project_id),
        ).fetchone()
        if row is None:
            return None
        if base_version is not None and int(row["version"]) != base_version:
            raise VersionConflictError(int(row["version"]))
        next_name = name.strip() if isinstance(name, str) and name.strip() else row["name"]
        next_version = int(row["version"]) + 1
        _record_auto_snapshot(conn, owner_user_id, project_id, doc, next_version, stamp)
        conn.execute(
            """
            UPDATE projects
            SET name = ?, doc = ?, version = ?, updated_at = ?
            WHERE owner_user_id = ? AND id = ?
            """,
            (next_name, _encode_doc(doc), next_version, stamp, owner_user_id, project_id),
        )
        conn.commit()
        return get_project(owner_user_id, project_id)
    finally:
        conn.close()


def rename_project(owner_user_id: int, project_id: str, name: str) -> bool:
    init_db()
    conn = _get_conn()
    try:
        cur = conn.execute(
            "UPDATE projects SET name = ?, updated_at = ? WHERE owner_user_id = ? AND id = ?",
            (name.strip() or "Untitled", _now(), owner_user_id, project_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_project(owner_user_id: int, project_id: str) -> bool:
    init_db()
    conn = _get_conn()
    try:
        cur = conn.execute(
            "DELETE FROM projects WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, project_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def list_versions(owner_user_id: int, project_id: str) -> list[dict]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT seq, kind, note, created_at
            FROM project_versions
            WHERE owner_user_id = ? AND project_id = ?
            ORDER BY seq DESC
            """,
            (owner_user_id, project_id),
        ).fetchall()
        return [
            {
                "seq": row["seq"],
                "kind": row["kind"],
                "note": row["note"],
                "createdAt": row["created_at"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def create_version(owner_user_id: int, project_id: str, note: str = "") -> dict | None:
    init_db()
    conn = _get_conn()
    try:
        project = conn.execute(
            "SELECT * FROM projects WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, project_id),
        ).fetchone()
        if project is None:
            return None
        version_id = uuid.uuid4().hex
        stamp = _now()
        seq = _next_seq(conn, project_id)
        conn.execute(
            """
            INSERT INTO project_versions
                (id, project_id, owner_user_id, version, seq, kind, note, doc, created_at)
            VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)
            """,
            (version_id, project_id, owner_user_id, project["version"], seq, note.strip(), project["doc"], stamp),
        )
        conn.commit()
        return {
            "seq": seq,
            "kind": "manual",
            "note": note.strip(),
            "createdAt": stamp,
            "created_at": stamp,
        }
    finally:
        conn.close()


def get_version_doc(owner_user_id: int, project_id: str, version_seq: int) -> dict | None:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT doc FROM project_versions
            WHERE owner_user_id = ? AND project_id = ? AND seq = ?
            """,
            (owner_user_id, project_id, version_seq),
        ).fetchone()
        return _decode_doc(row["doc"]) if row else None
    finally:
        conn.close()


def restore_version(owner_user_id: int, project_id: str, version_seq: int) -> dict | None:
    stamp = _now()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        project = conn.execute(
            "SELECT * FROM projects WHERE owner_user_id = ? AND id = ?",
            (owner_user_id, project_id),
        ).fetchone()
        if project is None:
            return None
        target = conn.execute(
            """
            SELECT doc FROM project_versions
            WHERE owner_user_id = ? AND project_id = ? AND seq = ?
            """,
            (owner_user_id, project_id, version_seq),
        ).fetchone()
        if target is None:
            return None
        conn.execute(
            """
            INSERT INTO project_versions
                (id, project_id, owner_user_id, version, seq, kind, note, doc, created_at)
            VALUES (?, ?, ?, ?, ?, 'restore', '回滚前自动备份', ?, ?)
            """,
            (
                uuid.uuid4().hex,
                project_id,
                owner_user_id,
                project["version"],
                _next_seq(conn, project_id),
                project["doc"],
                stamp,
            ),
        )
        conn.execute(
            """
            UPDATE projects SET doc = ?, version = version + 1, updated_at = ?
            WHERE owner_user_id = ? AND id = ?
            """,
            (target["doc"], stamp, owner_user_id, project_id),
        )
        conn.commit()
        return get_project(owner_user_id, project_id)
    finally:
        conn.close()


def resolve_ui_build_input(
    owner_user_id: int,
    ui_reference: str,
    theme_reference: str | None = None,
) -> dict | None:
    """Resolve a UiProject plus its snapshot-local Action Registry and release flags."""

    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT doc FROM projects WHERE owner_user_id = ?
            UNION ALL
            SELECT doc FROM project_versions WHERE owner_user_id = ?
            """,
            (owner_user_id, owner_user_id),
        ).fetchall()
        for row in rows:
            stored = _decode_doc(row["doc"])
            is_snapshot = stored.get("kind") == "lvgl-project-snapshot"
            ui = stored.get("uiProject") if is_snapshot else stored
            if not isinstance(ui, dict) or ui.get("kind") != "lvgl-ui-project":
                continue
            meta = ui.get("meta")
            if not isinstance(meta, dict):
                continue
            if f"{meta.get('id')}@{meta.get('revision')}" != ui_reference:
                continue
            if theme_reference is not None:
                prefix = f"{ui_reference}#theme:"
                if not theme_reference.startswith(prefix):
                    continue
                theme_id = theme_reference[len(prefix):]
                themes = ui.get("themes")
                if not isinstance(themes, list) or not any(
                    isinstance(theme, dict) and theme.get("id") == theme_id for theme in themes
                ):
                    continue
            return {
                "uiProject": ui,
                "actionRegistry": stored.get("actionRegistry", {}) if is_snapshot else {},
                "colorFormatConfirmed": stored.get("colorFormatConfirmed", False) if is_snapshot else False,
                "migrationNotes": stored.get("migrationNotes", []) if is_snapshot else [],
            }
        return None
    finally:
        conn.close()


def resolve_ui_revision(
    owner_user_id: int,
    ui_reference: str,
    theme_reference: str | None = None,
) -> dict | None:
    """Resolve only the UiProject portion for compatibility with catalogue callers."""

    resolved = resolve_ui_build_input(owner_user_id, ui_reference, theme_reference)
    return resolved["uiProject"] if resolved is not None else None


def delete_version(owner_user_id: int, project_id: str, version_seq: int) -> str:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT kind FROM project_versions
            WHERE owner_user_id = ? AND project_id = ? AND seq = ?
            """,
            (owner_user_id, project_id, version_seq),
        ).fetchone()
        if row is None:
            return "not_found"
        if row["kind"] != "manual":
            return "not_manual"
        conn.execute(
            "DELETE FROM project_versions WHERE owner_user_id = ? AND project_id = ? AND seq = ?",
            (owner_user_id, project_id, version_seq),
        )
        conn.commit()
        return "deleted"
    finally:
        conn.close()

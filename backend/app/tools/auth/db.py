"""SQLite-backed users, sessions, and permissions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

AUTH_DATA_DIR = Path(os.environ.get(
    "AUTH_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "auth_data"),
))
DB_PATH = AUTH_DATA_DIR / "auth.db"

SESSION_COOKIE = os.getenv("AUTH_SESSION_COOKIE", "index_session")

DEFAULT_USER_PERMISSIONS = {
    "tool.material_symbols.use",
    "tool.material_symbols.export",
    "tool.lvgl.use",
    "tool.lvgl.ai",
    "tool.datasheet.use",
    "tool.editor.use",
    "tool.embed.read",
    "tool.embed.write",
    "tool.pdf2dxf.use",
    "tool.qrcode.use",
    "tool.dxf2svg.use",
    "tool.dxf2layer.use",
    "admin.wiki_sync",
    "admin.deploy",
}

PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    ("tool.lvgl.build", "LVGL", "创建正式 LVGL UI Build"),
    ("tool.lvgl.profile.manage", "LVGL", "管理 LVGL Profile 和 BuildTarget"),
    ("tool.lvgl.publish", "LVGL", "批准和发布 LVGL UI Build"),
    ("tool.material_symbols.use", "Material Symbols", "打开并保存自己的图标项目"),
    ("tool.material_symbols.export", "Material Symbols", "导出 LVGL 字体 C 文件"),
    ("tool.lvgl.use", "LVGL", "打开 LVGL Web Designer"),
    ("tool.lvgl.ai", "LVGL", "使用 LVGL AI 对话/绘图"),
    ("tool.datasheet.use", "Datasheet", "使用规格书编辑器"),
    ("tool.editor.use", "Editor", "使用 Markdown/PDF 编辑器"),
    ("tool.embed.read", "Embed", "查看 Embed 项目预览"),
    ("tool.embed.write", "Embed", "上传、改名、删除 Embed 项目"),
    ("tool.embed.deploy", "Embed", "发布 Embed 项目到 CDN"),
    ("tool.pdf2dxf.use", "PDF2DXF", "使用 PDF 转 DXF"),
    ("tool.qrcode.use", "QRCode", "使用二维码工具"),
    ("tool.dxf2svg.use", "DXF2SVG", "使用 DXF/SVG 转换"),
    ("tool.dxf2layer.use", "DXF2Layer", "使用 DXF 分层编辑器"),
    ("admin.users", "Admin", "管理用户、角色、状态和权限"),
    ("admin.deploy", "Admin", "从 Gitea 拉取最新代码并部署到本地"),
    ("admin.wiki_sync", "Admin", "管理 Wiki 同步"),
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _get_conn() -> sqlite3.Connection:
    AUTH_DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    params = "n=16384,r=8,p=1"
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return "scrypt${}${}${}".format(
        params,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(derived).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, params, salt_b64, digest_b64 = stored.split("$", 3)
        if scheme != "scrypt":
            return False
        parsed = dict(part.split("=", 1) for part in params.split(","))
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(parsed["n"]),
            r=int(parsed["r"]),
            p=int(parsed["p"]),
            dklen=len(expected),
        )
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


def init_db() -> None:
    conn = _get_conn()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                is_active INTEGER NOT NULL DEFAULT 1,
                display_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS permissions (
                key TEXT PRIMARY KEY,
                group_name TEXT NOT NULL,
                description TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_permissions (
                user_id INTEGER NOT NULL,
                permission_key TEXT NOT NULL,
                granted_by INTEGER,
                granted_at TEXT NOT NULL,
                PRIMARY KEY (user_id, permission_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE,
                FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS user_permission_denies (
                user_id INTEGER NOT NULL,
                permission_key TEXT NOT NULL,
                denied_by INTEGER,
                denied_at TEXT NOT NULL,
                PRIMARY KEY (user_id, permission_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE,
                FOREIGN KEY (denied_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                user_agent TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        conn.executemany(
            """
            INSERT INTO permissions (key, group_name, description)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                group_name=excluded.group_name,
                description=excluded.description
            """,
            PERMISSIONS,
        )
        # 清理已从 PERMISSIONS 中移除的旧权限
        conn.execute(
            "DELETE FROM permissions WHERE key NOT IN ({})".format(
                ",".join("?" for _ in PERMISSIONS)
            ),
            tuple(p[0] for p in PERMISSIONS),
        )
        conn.commit()
        _bootstrap_admin(conn)
        _cleanup_expired_sessions(conn)
        conn.commit()
    finally:
        conn.close()


def _bootstrap_admin(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if existing:
        return
    username = os.getenv("AUTH_BOOTSTRAP_ADMIN", "").strip()
    password = os.getenv("AUTH_BOOTSTRAP_PASSWORD", "")
    if not username or not password:
        return
    stamp = iso(now_utc())
    conn.execute(
        """
        INSERT INTO users (username, password_hash, role, is_active, display_name, created_at, updated_at)
        VALUES (?, ?, 'admin', 1, ?, ?, ?)
        """,
        (username, hash_password(password), username, stamp, stamp),
    )


def _cleanup_expired_sessions(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (iso(now_utc()),))


def users_exist() -> bool:
    init_db()
    conn = _get_conn()
    try:
        return bool(conn.execute("SELECT 1 FROM users LIMIT 1").fetchone())
    finally:
        conn.close()


def row_to_user(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
        "display_name": row["display_name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_user(user_id: int) -> dict | None:
    init_db()
    conn = _get_conn()
    try:
        return row_to_user(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    finally:
        conn.close()


def get_user_with_hash_by_username(username: str) -> sqlite3.Row | None:
    init_db()
    conn = _get_conn()
    try:
        return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    finally:
        conn.close()


def authenticate_user(username: str, password: str) -> dict | None:
    row = get_user_with_hash_by_username(username.strip())
    if row is None or not row["is_active"]:
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return row_to_user(row)


def get_effective_permissions(user: dict) -> list[str]:
    init_db()
    conn = _get_conn()
    try:
        all_keys = [row["key"] for row in conn.execute("SELECT key FROM permissions ORDER BY key")]
        if user["role"] == "admin":
            return all_keys
        extra = {
            row["permission_key"]
            for row in conn.execute(
                "SELECT permission_key FROM user_permissions WHERE user_id = ?",
                (user["id"],),
            )
        }
        denied = {
            row["permission_key"]
            for row in conn.execute(
                "SELECT permission_key FROM user_permission_denies WHERE user_id = ?",
                (user["id"],),
            )
        }
        return sorted((DEFAULT_USER_PERMISSIONS | extra) - denied)
    finally:
        conn.close()


def list_permissions() -> list[dict]:
    init_db()
    conn = _get_conn()
    try:
        return [dict(row) for row in conn.execute("SELECT * FROM permissions ORDER BY group_name, key")]
    finally:
        conn.close()


def list_users() -> list[dict]:
    init_db()
    conn = _get_conn()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        users = [row_to_user(row) for row in rows]
        for user in users:
            user["permissions"] = get_effective_permissions(user)
        return users
    finally:
        conn.close()


def _assert_valid_role(role: str) -> None:
    if role not in ("admin", "user"):
        raise ValueError("invalid role")


def _active_admin_count(conn: sqlite3.Connection, exclude_user_id: int | None = None) -> int:
    sql = "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1"
    params: tuple = ()
    if exclude_user_id is not None:
        sql += " AND id <> ?"
        params = (exclude_user_id,)
    return int(conn.execute(sql, params).fetchone()[0])


def create_user(username: str, password: str, role: str = "user", display_name: str = "") -> dict:
    username = username.strip()
    display_name = display_name.strip() or username
    _assert_valid_role(role)
    if not username:
        raise ValueError("username is required")
    if len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    init_db()
    conn = _get_conn()
    try:
        stamp = iso(now_utc())
        cur = conn.execute(
            """
            INSERT INTO users (username, password_hash, role, is_active, display_name, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?)
            """,
            (username, hash_password(password), role, display_name, stamp, stamp),
        )
        conn.commit()
        return get_user(int(cur.lastrowid))
    except sqlite3.IntegrityError as exc:
        raise ValueError("username already exists") from exc
    finally:
        conn.close()


def update_user(
    user_id: int,
    *,
    role: str | None = None,
    is_active: bool | None = None,
    display_name: str | None = None,
) -> dict:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise KeyError("user not found")
        next_role = role if role is not None else row["role"]
        _assert_valid_role(next_role)
        next_active = int(is_active) if is_active is not None else int(row["is_active"])
        if row["role"] == "admin" and row["is_active"] and (next_role != "admin" or not next_active):
            if _active_admin_count(conn, exclude_user_id=user_id) < 1:
                raise ValueError("cannot remove the last active admin")
        next_display = display_name.strip() if display_name is not None else row["display_name"]
        conn.execute(
            """
            UPDATE users
            SET role = ?, is_active = ?, display_name = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_role, next_active, next_display, iso(now_utc()), user_id),
        )
        if not next_active:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return get_user(user_id)
    finally:
        conn.close()


def change_password(user_id: int, new_password: str) -> None:
    if len(new_password) < 8:
        raise ValueError("password must be at least 8 characters")
    init_db()
    conn = _get_conn()
    try:
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            raise KeyError("user not found")
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(new_password), iso(now_utc()), user_id),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


def delete_user(user_id: int) -> None:
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise KeyError("user not found")
        if row["role"] == "admin" and row["is_active"] and _active_admin_count(conn, exclude_user_id=user_id) < 1:
            raise ValueError("cannot delete the last active admin")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


def set_user_permissions(user_id: int, permission_keys: Iterable[str], granted_by: int) -> list[str]:
    init_db()
    keys = sorted(set(permission_keys))
    conn = _get_conn()
    try:
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            raise KeyError("user not found")
        known = {row["key"] for row in conn.execute("SELECT key FROM permissions")}
        unknown = [key for key in keys if key not in known]
        if unknown:
            raise ValueError(f"unknown permission: {unknown[0]}")
        selected = set(keys)
        default_denies = sorted(DEFAULT_USER_PERMISSIONS - selected)
        conn.execute("DELETE FROM user_permissions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_permission_denies WHERE user_id = ?", (user_id,))
        stamp = iso(now_utc())
        explicit_grants = sorted(selected - DEFAULT_USER_PERMISSIONS)
        conn.executemany(
            """
            INSERT INTO user_permissions (user_id, permission_key, granted_by, granted_at)
            VALUES (?, ?, ?, ?)
            """,
            [(user_id, key, granted_by, stamp) for key in explicit_grants],
        )
        conn.executemany(
            """
            INSERT INTO user_permission_denies (user_id, permission_key, denied_by, denied_at)
            VALUES (?, ?, ?, ?)
            """,
            [(user_id, key, granted_by, stamp) for key in default_denies],
        )
        conn.commit()
        user = get_user(user_id)
        return get_effective_permissions(user)
    finally:
        conn.close()


def create_session(user_id: int, user_agent: str = "", ip: str = "") -> tuple[str, str]:
    init_db()
    ttl_days = int(os.getenv("AUTH_SESSION_TTL_DAYS", "7") or "7")
    created_at = now_utc()
    expires_at = created_at + timedelta(days=max(1, ttl_days))
    session_id = secrets.token_urlsafe(32)
    conn = _get_conn()
    try:
        conn.execute(
            """
            INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, user_id, iso(created_at), iso(expires_at), user_agent[:300], ip[:80]),
        )
        conn.commit()
        return session_id, iso(expires_at)
    finally:
        conn.close()


def get_user_by_session(session_id: str) -> dict | None:
    if not session_id:
        return None
    init_db()
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT u.*
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ? AND s.expires_at > ?
            """,
            (session_id, iso(now_utc())),
        ).fetchone()
        if row is None:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
            return None
        user = row_to_user(row)
        if not user["is_active"]:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
            return None
        return user
    finally:
        conn.close()


def delete_session(session_id: str) -> None:
    if not session_id:
        return
    init_db()
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()

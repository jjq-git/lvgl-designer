"""Hashed service credentials and explicit external-tenant ownership mappings."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DATA_DIR = Path(os.environ.get(
    "LVGL_DATA_DIR",
    str(Path(__file__).resolve().parents[4] / "lvgl_data"),
))
DB_PATH = DATA_DIR / "iot_integrations.db"
TOKEN_PREFIX = "lvgl_iot_"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS service_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hint TEXT NOT NULL UNIQUE,
    token_sha256 TEXT NOT NULL,
    scopes TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_mappings (
    client_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (client_id, tenant_id),
    FOREIGN KEY (client_id) REFERENCES service_clients(id)
);
CREATE TABLE IF NOT EXISTS integration_audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integration_audit_client
ON integration_audit(client_id, tenant_id, seq DESC);
CREATE TABLE IF NOT EXISTS integration_exchanges (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (client_id, tenant_id, idempotency_key),
    FOREIGN KEY (client_id) REFERENCES service_clients(id)
);
CREATE INDEX IF NOT EXISTS idx_integration_exchanges_owner
ON integration_exchanges(owner_user_id, created_at DESC, id DESC);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = _connect()
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_service_client(name: str, scopes: Iterable[str]) -> tuple[dict[str, Any], str]:
    """Provision a client and return its plaintext credential exactly once."""

    clean_scopes = sorted({scope.strip() for scope in scopes if scope.strip()})
    if not name.strip() or not clean_scopes:
        raise ValueError("service client name and at least one scope are required")
    init_db()
    client_id = secrets.token_hex(12)
    hint = secrets.token_hex(6)
    token = f"{TOKEN_PREFIX}{hint}.{secrets.token_urlsafe(32)}"
    stamp = _now()
    conn = _connect()
    try:
        conn.execute(
            """INSERT INTO service_clients
               (id, name, token_hint, token_sha256, scopes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (client_id, name.strip(), hint, _token_hash(token), json.dumps(clean_scopes), stamp, stamp),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": client_id, "name": name.strip(), "scopes": clean_scopes, "active": True}, token


def rotate_service_token(client_id: str) -> str | None:
    init_db()
    hint = secrets.token_hex(6)
    token = f"{TOKEN_PREFIX}{hint}.{secrets.token_urlsafe(32)}"
    conn = _connect()
    try:
        changed = conn.execute(
            "UPDATE service_clients SET token_hint = ?, token_sha256 = ?, updated_at = ? WHERE id = ?",
            (hint, _token_hash(token), _now(), client_id),
        ).rowcount
        conn.commit()
        return token if changed else None
    finally:
        conn.close()


def set_tenant_mapping(client_id: str, tenant_id: str, owner_user_id: int) -> None:
    if not tenant_id.strip() or len(tenant_id) > 160 or owner_user_id < 1:
        raise ValueError("tenant_id and a positive owner_user_id are required")
    init_db()
    stamp = _now()
    conn = _connect()
    try:
        conn.execute(
            """INSERT INTO tenant_mappings
               (client_id, tenant_id, owner_user_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(client_id, tenant_id) DO UPDATE SET
                   owner_user_id = excluded.owner_user_id, updated_at = excluded.updated_at""",
            (client_id, tenant_id.strip(), owner_user_id, stamp, stamp),
        )
        conn.commit()
    finally:
        conn.close()


def authenticate(token: str, tenant_id: str) -> dict[str, Any] | None:
    if not token.startswith(TOKEN_PREFIX) or "." not in token or not tenant_id:
        return None
    hint = token[len(TOKEN_PREFIX):].split(".", 1)[0]
    init_db()
    conn = _connect()
    try:
        row = conn.execute(
            """SELECT c.*, m.owner_user_id
               FROM service_clients c
               JOIN tenant_mappings m ON m.client_id = c.id
               WHERE c.token_hint = ? AND m.tenant_id = ? AND c.active = 1""",
            (hint, tenant_id),
        ).fetchone()
        if row is None or not hmac.compare_digest(row["token_sha256"], _token_hash(token)):
            return None
        return {
            "clientId": row["id"],
            "clientName": row["name"],
            "tenantId": tenant_id,
            "ownerUserId": row["owner_user_id"],
            "scopes": json.loads(row["scopes"]),
        }
    finally:
        conn.close()


def record_access(principal: dict[str, Any], action: str, resource_id: str | None = None) -> None:
    init_db()
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO integration_audit (client_id, tenant_id, action, resource_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (principal["clientId"], principal["tenantId"], action, resource_id, _now()),
        )
        conn.commit()
    finally:
        conn.close()


class IdempotencyConflictError(ValueError):
    """An idempotency key was reused for a different immutable request."""


def _exchange_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "eventType": row["event_type"],
        "uiBuildId": row["resource_id"],
        "payload": json.loads(row["payload"]),
        "createdAt": row["created_at"],
    }


def record_exchange(
    principal: dict[str, Any],
    idempotency_key: str,
    event_type: str,
    resource_id: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """Append an immutable exchange or return the identical prior result."""

    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    init_db()
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            """SELECT * FROM integration_exchanges
               WHERE client_id = ? AND tenant_id = ? AND idempotency_key = ?""",
            (principal["clientId"], principal["tenantId"], idempotency_key),
        ).fetchone()
        if existing is not None:
            if (
                existing["request_sha256"] != digest
                or existing["event_type"] != event_type
                or existing["resource_id"] != resource_id
            ):
                conn.rollback()
                raise IdempotencyConflictError("idempotency key was already used for a different request")
            conn.rollback()
            return _exchange_record(existing), False

        exchange_id = secrets.token_hex(16)
        stamp = _now()
        conn.execute(
            """INSERT INTO integration_exchanges
               (id, client_id, tenant_id, owner_user_id, idempotency_key, event_type,
                resource_id, request_sha256, payload, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                exchange_id, principal["clientId"], principal["tenantId"],
                principal["ownerUserId"], idempotency_key, event_type, resource_id,
                digest, encoded, stamp,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM integration_exchanges WHERE id = ?", (exchange_id,)).fetchone()
        return _exchange_record(row), True
    finally:
        conn.close()


def list_exchanges(owner_user_id: int, limit: int = 100) -> list[dict[str, Any]]:
    init_db()
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT * FROM integration_exchanges
               WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?""",
            (owner_user_id, limit),
        ).fetchall()
        return [_exchange_record(row) for row in rows]
    finally:
        conn.close()

"""Provision/rotate the LVGL IoT service identity outside the HTTP surface."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tools.auth import db as auth_db  # noqa: E402
from app.tools.lvgl_iot import db as integration_db  # noqa: E402


DEFAULT_SCOPES = "lvgl.build.read,lvgl.artifact.read,lvgl.preview.read"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage LVGL IoT M2M credentials")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="create a service client and tenant mapping")
    create.add_argument("--name", required=True)
    create.add_argument("--tenant", required=True)
    create.add_argument("--owner-user-id", required=True, type=int)
    create.add_argument("--scopes", default=DEFAULT_SCOPES)

    rotate = commands.add_parser("rotate", help="invalidate the old credential and issue a new one")
    rotate.add_argument("--client-id", required=True)

    mapping = commands.add_parser("map-tenant", help="create or update a client tenant mapping")
    mapping.add_argument("--client-id", required=True)
    mapping.add_argument("--tenant", required=True)
    mapping.add_argument("--owner-user-id", required=True, type=int)
    return parser


def _require_owner(owner_user_id: int) -> None:
    if auth_db.get_user(owner_user_id) is None:
        raise SystemExit(f"owner user {owner_user_id} does not exist")


def main() -> None:
    args = _parser().parse_args()
    if args.command == "create":
        _require_owner(args.owner_user_id)
        scopes = [item.strip() for item in args.scopes.split(",") if item.strip()]
        client, token = integration_db.create_service_client(args.name, scopes)
        integration_db.set_tenant_mapping(client["id"], args.tenant, args.owner_user_id)
        print(json.dumps({
            "clientId": client["id"],
            "tenantId": args.tenant,
            "ownerUserId": args.owner_user_id,
            "scopes": client["scopes"],
            "token": token,
            "warning": "Store this token now; only its SHA-256 digest is persisted.",
        }, ensure_ascii=False, indent=2))
    elif args.command == "rotate":
        token = integration_db.rotate_service_token(args.client_id)
        if token is None:
            raise SystemExit("service client not found")
        print(json.dumps({
            "clientId": args.client_id,
            "token": token,
            "warning": "The previous token is invalid. Store this token now.",
        }, ensure_ascii=False, indent=2))
    else:
        _require_owner(args.owner_user_id)
        try:
            integration_db.set_tenant_mapping(args.client_id, args.tenant, args.owner_user_id)
        except Exception as exc:
            raise SystemExit(f"could not update mapping: {exc}") from exc
        print(json.dumps({
            "clientId": args.client_id,
            "tenantId": args.tenant,
            "ownerUserId": args.owner_user_id,
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Export and merge LVGL project data without replacing remote user databases."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


RELEASE_RE = re.compile(r"^[0-9A-Za-z._-]+$")


def sqlite_backup(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(str(source))
    target_connection = sqlite3.connect(str(target))
    try:
        source_connection.backup(target_connection)
    finally:
        target_connection.close()
        source_connection.close()


def export_data(source_root: Path, output_root: Path) -> None:
    projects_db = source_root / "projects.db"
    assets_db = source_root / "assets.db"
    if not projects_db.is_file() or not assets_db.is_file():
        raise SystemExit(f"LVGL data databases are missing below {source_root}")

    output_root.mkdir(parents=True, exist_ok=True)
    sqlite_backup(projects_db, output_root / "projects.db")
    sqlite_backup(assets_db, output_root / "assets.db")
    source_blobs = source_root / "asset_blobs"
    if source_blobs.is_dir():
        shutil.copytree(source_blobs, output_root / "asset_blobs", dirs_exist_ok=True)

    project_count = sqlite3.connect(output_root / "projects.db").execute(
        "SELECT COUNT(*) FROM projects"
    ).fetchone()[0]
    asset_count = sqlite3.connect(output_root / "assets.db").execute(
        "SELECT COUNT(*) FROM asset_objects"
    ).fetchone()[0]
    print(json.dumps({"exportedProjects": project_count, "exportedAssets": asset_count}))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def merge_assets(source_root: Path, target_root: Path, owner_id: int) -> tuple[int, int]:
    source = sqlite3.connect(str(source_root / "assets.db"))
    source.row_factory = sqlite3.Row
    target = sqlite3.connect(str(target_root / "assets.db"))
    target.row_factory = sqlite3.Row
    copied = 0
    owned = 0
    try:
        target.execute("PRAGMA foreign_keys=ON")
        target.execute("BEGIN IMMEDIATE")
        for row in source.execute("SELECT * FROM asset_objects ORDER BY sha256"):
            storage_path = Path(row["storage_path"])
            if storage_path.is_absolute() or ".." in storage_path.parts:
                raise ValueError(f"unsafe asset path: {storage_path}")
            source_blob = source_root / "asset_blobs" / storage_path
            if not source_blob.is_file():
                raise FileNotFoundError(f"asset blob is missing: {source_blob}")
            if source_blob.stat().st_size != row["byte_size"] or sha256_file(source_blob) != row["sha256"]:
                raise ValueError(f"asset blob failed integrity validation: {row['sha256']}")
            target_blob = target_root / "asset_blobs" / storage_path
            if not target_blob.exists():
                target_blob.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_blob, target_blob)
                copied += 1
            target.execute(
                """
                INSERT INTO asset_objects (sha256, byte_size, storage_path, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(sha256) DO NOTHING
                """,
                (row["sha256"], row["byte_size"], row["storage_path"], row["created_at"]),
            )

        for row in source.execute(
            "SELECT * FROM asset_owners WHERE owner_user_id = ? ORDER BY sha256", (owner_id,)
        ):
            target.execute(
                """
                INSERT INTO asset_owners
                    (owner_user_id, sha256, file_name, mime_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_user_id, sha256) DO UPDATE SET
                    file_name = excluded.file_name,
                    mime_type = excluded.mime_type,
                    updated_at = excluded.updated_at
                """,
                (
                    owner_id,
                    row["sha256"],
                    row["file_name"],
                    row["mime_type"],
                    row["created_at"],
                    row["updated_at"],
                ),
            )
            owned += 1
        target.commit()
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()
        source.close()
    return copied, owned


def merge_projects(source_root: Path, target_root: Path, owner_id: int, release_id: str) -> dict[str, int]:
    source = sqlite3.connect(str(source_root / "projects.db"))
    source.row_factory = sqlite3.Row
    target = sqlite3.connect(str(target_root / "projects.db"))
    target.row_factory = sqlite3.Row
    result = {"inserted": 0, "updated": 0, "unchanged": 0}
    stamp = datetime.now(timezone.utc).isoformat()
    try:
        target.execute("PRAGMA foreign_keys=ON")
        target.execute("BEGIN IMMEDIATE")
        rows = source.execute(
            "SELECT * FROM projects WHERE owner_user_id = ? ORDER BY name", (owner_id,)
        ).fetchall()
        for row in rows:
            json.loads(row["doc"])
            existing = target.execute(
                """
                SELECT * FROM projects
                WHERE owner_user_id = ? AND name = ?
                ORDER BY updated_at DESC LIMIT 1
                """,
                (owner_id, row["name"]),
            ).fetchone()
            if existing is None:
                project_id = row["id"]
                collision = target.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
                if collision:
                    project_id = uuid.uuid4().hex
                target.execute(
                    """
                    INSERT INTO projects
                        (id, owner_user_id, name, doc, version, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        owner_id,
                        row["name"],
                        row["doc"],
                        row["version"],
                        row["created_at"],
                        stamp,
                    ),
                )
                result["inserted"] += 1
                continue

            if existing["doc"] == row["doc"]:
                result["unchanged"] += 1
                continue

            next_seq = target.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM project_versions WHERE project_id = ?",
                (existing["id"],),
            ).fetchone()[0]
            target.execute(
                """
                INSERT INTO project_versions
                    (id, project_id, owner_user_id, version, seq, kind, note, doc, created_at)
                VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    existing["id"],
                    owner_id,
                    existing["version"],
                    next_seq,
                    f"before deployment sync {release_id}",
                    existing["doc"],
                    stamp,
                ),
            )
            next_version = max(int(existing["version"]) + 1, int(row["version"]))
            target.execute(
                """
                UPDATE projects SET doc = ?, version = ?, updated_at = ?
                WHERE id = ? AND owner_user_id = ?
                """,
                (row["doc"], next_version, stamp, existing["id"], owner_id),
            )
            result["updated"] += 1
        target.commit()
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()
        source.close()
    return result


def merge_data(source_root: Path, target_root: Path, backup_root: Path, release_id: str, owner_id: int) -> None:
    if not RELEASE_RE.fullmatch(release_id):
        raise SystemExit("invalid release id")
    for name in ("projects.db", "assets.db"):
        if not (source_root / name).is_file() or not (target_root / name).is_file():
            raise SystemExit(f"required database is missing: {name}")

    backup_dir = backup_root / f"lvgl-data-{release_id}"
    if backup_dir.exists():
        raise SystemExit(f"backup already exists: {backup_dir}")
    backup_dir.mkdir(parents=True)
    sqlite_backup(target_root / "projects.db", backup_dir / "projects.db")
    sqlite_backup(target_root / "assets.db", backup_dir / "assets.db")

    copied_assets, owned_assets = merge_assets(source_root, target_root, owner_id)
    projects = merge_projects(source_root, target_root, owner_id, release_id)
    print(json.dumps({
        "backup": str(backup_dir),
        "projects": projects,
        "copiedAssetBlobs": copied_assets,
        "ownedAssets": owned_assets,
    }, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export")
    export_parser.add_argument("source_root", type=Path)
    export_parser.add_argument("output_root", type=Path)
    merge_parser = subparsers.add_parser("merge")
    merge_parser.add_argument("source_root", type=Path)
    merge_parser.add_argument("target_root", type=Path)
    merge_parser.add_argument("backup_root", type=Path)
    merge_parser.add_argument("release_id")
    merge_parser.add_argument("--owner-id", type=int, default=1)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "export":
        export_data(args.source_root.resolve(), args.output_root.resolve())
    else:
        merge_data(
            args.source_root.resolve(),
            args.target_root.resolve(),
            args.backup_root.resolve(),
            args.release_id,
            args.owner_id,
        )


if __name__ == "__main__":
    main()

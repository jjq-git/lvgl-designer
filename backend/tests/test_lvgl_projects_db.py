import pytest

from app.tools.lvgl_projects import db


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    data_dir = tmp_path / "lvgl_data"
    monkeypatch.setattr(db, "DATA_DIR", data_dir)
    monkeypatch.setattr(db, "DB_PATH", data_dir / "projects.db")
    db.init_db()
    return db


def test_project_versions_match_designer_contract(isolated_db):
    storage = isolated_db
    project = storage.create_project(7, "Panel", {"step": 1})

    saved = storage.update_project(7, project["id"], {"step": 2}, base_version=1)
    assert saved["version"] == 2

    with pytest.raises(storage.VersionConflictError) as conflict:
        storage.update_project(7, project["id"], {"step": 99}, base_version=1)
    assert conflict.value.current == 2

    manual = storage.create_version(7, project["id"], "approved")
    assert manual["seq"] == 2
    assert manual["kind"] == "manual"

    storage.update_project(7, project["id"], {"step": 3}, base_version=2)
    restored = storage.restore_version(7, project["id"], manual["seq"])
    assert restored["version"] == 4
    assert restored["doc"] == {"step": 2}

    versions = storage.list_versions(7, project["id"])
    assert [(item["seq"], item["kind"]) for item in versions] == [
        (3, "restore"),
        (2, "manual"),
        (1, "auto"),
    ]
    assert storage.get_version_doc(7, project["id"], 2) == {"step": 2}

    assert storage.delete_version(7, project["id"], 1) == "not_manual"
    assert storage.delete_version(7, project["id"], 2) == "deleted"
    assert storage.delete_version(7, project["id"], 2) == "not_found"


def test_existing_database_schema_is_upgraded(tmp_path, monkeypatch):
    data_dir = tmp_path / "legacy"
    data_dir.mkdir()
    db_path = data_dir / "projects.db"

    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE project_versions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            owner_user_id INTEGER NOT NULL,
            version INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            doc TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        INSERT INTO project_versions VALUES
            ('old', 'project', 1, 1, 'legacy', '{}', '2026-01-01T00:00:00+00:00');
        """
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(db, "DATA_DIR", data_dir)
    monkeypatch.setattr(db, "DB_PATH", db_path)
    db.init_db()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT seq, kind FROM project_versions WHERE id = 'old'").fetchone()
    conn.close()
    assert dict(row) == {"seq": 1, "kind": "manual"}

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.tools.auth import db as auth_db
from app.tools.lvgl_catalog import db
from app.tools.lvgl_projects import db as project_db
from app.tools.lvgl_projects.validation import (
    ProjectDocumentValidationError,
    validate_catalog_document,
)


@pytest.fixture()
def isolated_catalog(tmp_path, monkeypatch):
    data_dir = tmp_path / "catalog"
    monkeypatch.setattr(db, "DATA_DIR", data_dir)
    monkeypatch.setattr(db, "DB_PATH", data_dir / "catalog.db")
    db.init_db()
    return db


def display_profile(revision=1):
    return {
        "schemaVersion": 1,
        "kind": "display-profile",
        "id": "display:panel-240",
        "revision": revision,
        "logicalSize": {"width": 240, "height": 240},
        "shape": "round",
        "colorFormat": "RGB565",
    }


def input_profile():
    return {
        "schemaVersion": 1,
        "kind": "input-profile",
        "id": "input:panel-touch",
        "revision": 1,
        "rawSize": {"width": 4096, "height": 4096},
    }


def controller_profile():
    return {
        "schemaVersion": 1,
        "kind": "controller-profile",
        "id": "controller:panel",
        "revision": 1,
        "model": "86-panel",
        "displayRef": "display:panel-240@1",
        "inputProfileRef": "input:panel-touch@1",
        "frame": {
            "assetRef": "asset:panel-frame@sha256:12345678",
            "viewBox": {"x": 0, "y": 0, "width": 320, "height": 320},
            "screenViewport": {"x": 40, "y": 40, "width": 240, "height": 240, "rotation": 0},
        },
    }


def firmware_profile():
    return {
        "schemaVersion": 1,
        "kind": "firmware-profile",
        "id": "firmware:panel-esp32s3",
        "revision": 1,
        "target": "esp32s3",
        "uiAbiVersion": "1.0.0",
        "capabilityRevision": 1,
        "supportedWidgets": ["button", "label", "slider"],
        "supportedSubjects": ["bool", "int", "string"],
        "supportedActions": ["navigate", "set_subject"],
        "lvConf": {"LV_USE_SLIDER": True, "LV_COLOR_DEPTH": 16},
        "memoryBudgetBytes": 1048576,
    }


def build_target():
    return {
        "schemaVersion": 1,
        "kind": "lvgl-build-target",
        "id": "target:panel-release",
        "revision": 1,
        "uiProjectRef": "ui:panel@1",
        "controllerProfileRef": "controller:panel@1",
        "themeRef": "ui:panel@1#theme:default",
        "firmwareProfileRef": "firmware:panel-esp32s3@1",
        "lvglVersion": "9.5.0",
    }


def theme_revision(theme_id="theme:brand", revision=1, parent=None, tokens=None):
    return {
        "schemaVersion": 1,
        "kind": "lvgl-theme",
        "id": theme_id,
        "revision": revision,
        **({"extends": parent} if parent else {}),
        "tokens": tokens or [{"id": "color.text.primary", "type": "color", "value": "#112233"}],
    }


def test_immutable_revisions_are_sequential_idempotent_and_owner_scoped(isolated_catalog):
    storage = isolated_catalog
    first, created = storage.publish_revision(7, 7, display_profile())
    assert created is True
    assert first["sha256"] and first["doc"] == display_profile()

    retry, created = storage.publish_revision(7, 7, display_profile())
    assert created is False
    assert retry["sha256"] == first["sha256"]

    changed = display_profile()
    changed["colorFormat"] = "ARGB8888"
    with pytest.raises(storage.RevisionConflictError):
        storage.publish_revision(7, 7, changed)
    with pytest.raises(storage.RevisionSequenceError) as skipped:
        storage.publish_revision(7, 7, display_profile(3))
    assert skipped.value.expected == 2

    second, created = storage.publish_revision(7, 7, display_profile(2))
    assert created is True and second["revision"] == 2
    other_owner, _ = storage.publish_revision(8, 8, display_profile())
    assert other_owner["revision"] == 1
    assert [item["revision"] for item in storage.list_latest(7, "display-profile")] == [2]
    assert storage.get_revision(8, "display-profile", "display:panel-240", 2) is None


def test_profile_and_build_target_references_must_resolve_for_same_owner(isolated_catalog):
    storage = isolated_catalog
    with pytest.raises(storage.ReferenceNotFoundError) as missing:
        storage.publish_revision(7, 7, controller_profile())
    assert missing.value.reference == "display:panel-240@1"

    storage.publish_revision(7, 7, display_profile())
    storage.publish_revision(7, 7, input_profile())
    storage.publish_revision(7, 7, controller_profile())
    storage.publish_revision(7, 7, firmware_profile())
    target, created = storage.publish_revision(7, 7, build_target())
    assert created is True
    assert target["doc"]["controllerProfileRef"] == "controller:panel@1"

    with pytest.raises(storage.ReferenceNotFoundError):
        storage.publish_revision(8, 8, controller_profile())


def test_standalone_theme_revisions_are_immutable_and_referenceable(isolated_catalog):
    storage = isolated_catalog
    base, created = storage.publish_revision(7, 7, theme_revision())
    assert created is True
    assert base["id"] == "theme:brand"

    derived = theme_revision(
        "theme:brand-dark",
        parent="theme:brand@1",
        tokens=[{"id": "color.text.primary", "type": "color", "value": "#ffffff"}],
    )
    child, created = storage.publish_revision(7, 7, derived)
    assert created is True
    assert child["doc"]["extends"] == "theme:brand@1"
    assert storage.get_reference(7, "theme:brand-dark@1")["sha256"] == child["sha256"]
    assert storage.get_reference(8, "theme:brand-dark@1") is None

    missing_parent = theme_revision("theme:missing-parent", parent="theme:nope@1")
    with pytest.raises(storage.ReferenceNotFoundError):
        storage.publish_revision(7, 7, missing_parent)


def test_generated_catalog_schemas_and_semantic_ids_are_enforced():
    assert validate_catalog_document(firmware_profile(), "firmware-profile")["target"] == "esp32s3"

    bad_id = display_profile()
    bad_id["id"] = "Display:Uppercase"
    with pytest.raises(ProjectDocumentValidationError) as invalid:
        validate_catalog_document(bad_id, "display-profile")
    assert {issue["code"] for issue in invalid.value.issues} >= {"bad-catalog-id"}

    bad_theme = build_target()
    bad_theme["themeRef"] = "ui:other@1#theme:default"
    with pytest.raises(ProjectDocumentValidationError) as mismatch:
        validate_catalog_document(bad_theme, "lvgl-build-target")
    assert "theme-ref-mismatch" in {issue["code"] for issue in mismatch.value.issues}

    assert validate_catalog_document(theme_revision(), "lvgl-theme")["kind"] == "lvgl-theme"
    duplicate = theme_revision(tokens=[
        {"id": "color.text.primary", "type": "color", "value": "#112233"},
        {"id": "color.text.primary", "type": "color", "value": "#445566"},
    ])
    with pytest.raises(ProjectDocumentValidationError) as duplicate_error:
        validate_catalog_document(duplicate, "lvgl-theme")
    assert "duplicate-token" in {issue["code"] for issue in duplicate_error.value.issues}


def test_ui_and_theme_revision_resolve_from_owner_project_history(tmp_path, monkeypatch):
    data_dir = tmp_path / "projects"
    monkeypatch.setattr(project_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(project_db, "DB_PATH", data_dir / "projects.db")
    ui = {
        "schemaVersion": 2,
        "kind": "lvgl-ui-project",
        "meta": {"id": "ui:panel", "revision": 1},
        "themes": [{"id": "default", "tokens": []}],
    }
    project_db.create_project(7, "Panel", {"kind": "lvgl-project-snapshot", "uiProject": ui})

    assert project_db.resolve_ui_revision(7, "ui:panel@1", "ui:panel@1#theme:default") == ui
    assert project_db.resolve_ui_revision(7, "ui:panel@1", "ui:panel@1#theme:missing") is None
    assert project_db.resolve_ui_revision(8, "ui:panel@1", "ui:panel@1#theme:default") is None


def test_elevated_lvgl_permissions_are_registered_but_not_granted_by_default():
    keys = {item[0] for item in auth_db.PERMISSIONS}
    elevated = {"tool.lvgl.build", "tool.lvgl.profile.manage", "tool.lvgl.publish"}
    assert elevated <= keys
    assert elevated.isdisjoint(auth_db.DEFAULT_USER_PERMISSIONS)


def test_catalog_api_enforces_manage_for_writes_and_use_for_reads(
    isolated_catalog,
    monkeypatch,
    tmp_path,
):
    from app.routes import lvgl_catalog
    from app.tools.auth import security

    granted = {"tool.lvgl.use"}
    monkeypatch.setattr(security, "users_exist", lambda: True)
    monkeypatch.setattr(
        security,
        "get_user_by_session",
        lambda session_id: {
            "id": 7,
            "username": "designer",
            "role": "user",
            "is_active": True,
        } if session_id == "valid" else None,
    )
    monkeypatch.setattr(security, "get_effective_permissions", lambda _user: sorted(granted))
    project_data_dir = tmp_path / "api-projects"
    monkeypatch.setattr(project_db, "DATA_DIR", project_data_dir)
    monkeypatch.setattr(project_db, "DB_PATH", project_data_dir / "projects.db")

    api = FastAPI()
    api.include_router(lvgl_catalog.router, prefix="/api/lvgl/catalog")
    client = TestClient(api)
    client.cookies.set(auth_db.SESSION_COOKIE, "valid")

    denied = client.post("/api/lvgl/catalog/profiles/display", json={"doc": display_profile()})
    assert denied.status_code == 403

    granted.add("tool.lvgl.profile.manage")
    created = client.post("/api/lvgl/catalog/profiles/display", json={"doc": display_profile()})
    assert created.status_code == 201
    assert created.json()["created"] is True

    retry = client.post("/api/lvgl/catalog/profiles/display", json={"doc": display_profile()})
    assert retry.status_code == 200
    assert retry.json()["created"] is False

    listed = client.get("/api/lvgl/catalog/profiles?kind=display")
    assert listed.status_code == 200
    assert listed.json()["profiles"][0]["id"] == "display:panel-240"

    theme = client.post("/api/lvgl/catalog/themes", json={"doc": theme_revision()})
    assert theme.status_code == 201
    assert client.get("/api/lvgl/catalog/themes").json()["themes"][0]["id"] == "theme:brand"
    assert client.get("/api/lvgl/catalog/themes/theme:brand/revisions/1").status_code == 200

    for kind, doc in (
        ("input", input_profile()),
        ("controller", controller_profile()),
        ("firmware", firmware_profile()),
    ):
        assert client.post(f"/api/lvgl/catalog/profiles/{kind}", json={"doc": doc}).status_code == 201

    ui = {
        "schemaVersion": 2,
        "kind": "lvgl-ui-project",
        "meta": {"id": "ui:panel", "revision": 1},
        "designDisplayRef": "display:panel-240@1",
        "themes": [{"id": "default", "tokens": []}],
    }
    project_db.create_project(7, "Panel", ui)
    target = client.post("/api/lvgl/catalog/build-targets", json={"doc": build_target()})
    assert target.status_code == 201

    standalone_target = build_target()
    standalone_target.update({"id": "target:standalone", "themeRef": "theme:brand@1"})
    assert client.post(
        "/api/lvgl/catalog/build-targets", json={"doc": standalone_target},
    ).status_code == 201

    bad_ui = dict(ui)
    bad_ui["meta"] = {"id": "ui:bad", "revision": 1}
    bad_ui["designDisplayRef"] = "display:other@1"
    project_db.create_project(7, "Bad", bad_ui)
    mismatch_target = build_target()
    mismatch_target.update({
        "id": "target:bad",
        "uiProjectRef": "ui:bad@1",
        "themeRef": "ui:bad@1#theme:default",
    })
    mismatch = client.post("/api/lvgl/catalog/build-targets", json={"doc": mismatch_target})
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"]["code"] == "build-target-display-mismatch"

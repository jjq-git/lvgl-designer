import hashlib
import base64
import sys
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.tools.auth import db as auth_db
from app.tools.lvgl_assets import store as asset_store
from app.tools.lvgl_builds import compile_gate, db, runner, service
from app.tools.lvgl_catalog import db as catalog_db
from app.tools.lvgl_projects import db as project_db
from tests.test_lvgl_project_validation import project_snapshot


@pytest.fixture()
def isolated_builds(tmp_path, monkeypatch):
    data_dir = tmp_path / "lvgl"
    monkeypatch.setattr(db, "DATA_DIR", data_dir)
    monkeypatch.setattr(db, "DB_PATH", data_dir / "builds.db")
    monkeypatch.setattr(db, "ARTIFACT_ROOT", data_dir / "artifacts")
    db.init_db()
    return db


def _advance_to_building(storage, build_id, owner=7):
    storage.transition_build(owner, build_id, "validating", None)
    storage.transition_build(owner, build_id, "building", None)


def test_build_state_machine_seals_deterministic_immutable_artifacts(isolated_builds):
    storage = isolated_builds
    input_lock = {"formatVersion": 1, "uiProject": {"id": "ui:panel", "revision": 1}}
    first = storage.create_build(7, 7, "target:panel", 1, input_lock)
    assert first["state"] == "queued"
    assert storage.get_build(8, first["id"]) is None
    with pytest.raises(storage.BuildStateError):
        storage.transition_build(7, first["id"], "approved", 7)

    _advance_to_building(storage, first["id"])
    with pytest.raises(storage.ArtifactValidationError):
        storage.complete_build(
            7, first["id"], {"../escape.c": "bad"}, [], {"version": "test"},
        )
    assert storage.get_build(7, first["id"])["state"] == "building"

    files = {"ui.c": "void ui_init(void) {}\n", "screens/main.h": "#pragma once\n"}
    succeeded = storage.complete_build(
        7, first["id"], files, [{"severity": "warning", "code": "W_TEST"}],
        {"version": "@lvd/codegen@0.1.0", "lvglVersion": "9.5.0"},
    )
    assert succeeded["state"] == "succeeded"
    artifact = storage.get_artifact(7, first["id"])
    assert artifact["sha256"] == hashlib.sha256(artifact["path"].read_bytes()).hexdigest()
    with zipfile.ZipFile(artifact["path"]) as archive:
        assert set(archive.namelist()) == {
            "build-manifest.json", "diagnostics.json", "screens/main.h", "ui.c",
        }
        manifest = archive.read("build-manifest.json").decode("utf-8")
        assert succeeded["inputSha256"] in manifest

    with pytest.raises(storage.BuildStateError):
        storage.complete_build(7, first["id"], files, [], {"version": "test"})
    with pytest.raises(storage.BuildApprovalError) as approval:
        storage.transition_build(7, first["id"], "approved", 7)
    assert approval.value.code == "compile-validation-required"

    second = storage.create_build(7, 7, "target:panel", 1, input_lock)
    _advance_to_building(storage, second["id"])
    storage.complete_build(
        7, second["id"], files, [{"severity": "warning", "code": "W_TEST"}],
        {"version": "@lvd/codegen@0.1.0", "lvglVersion": "9.5.0"},
    )
    assert storage.get_artifact(7, second["id"])["sha256"] == artifact["sha256"]


def test_publish_supersedes_prior_build_and_preserves_audit_history(isolated_builds):
    storage = isolated_builds
    builds = []
    for _ in range(2):
        build = storage.create_build(7, 7, "target:panel", 1, {"same": "input"})
        _advance_to_building(storage, build["id"])
        storage.complete_build(7, build["id"], {"ui.c": "x"}, [], {
            "version": "test",
            "compileValidation": {
                "policy": "esp-idf", "status": "passed", "releaseQualified": True,
            },
        })
        storage.transition_build(7, build["id"], "approved", 99)
        builds.append(build)

    storage.publish_build(7, builds[0]["id"], 99)
    storage.publish_build(7, builds[1]["id"], 99)
    assert storage.get_build(7, builds[0]["id"])["state"] == "superseded"
    assert storage.get_build(7, builds[1]["id"])["state"] == "published"
    assert "superseded" in [event["type"] for event in storage.list_events(7, builds[0]["id"])]
    rolled_back = storage.transition_build(7, builds[1]["id"], "rolled_back", 99)
    assert rolled_back["state"] == "rolled_back"


def test_failed_build_cannot_be_retried_by_mutating_same_build(isolated_builds):
    storage = isolated_builds
    build = storage.create_build(7, 7, "target:panel", 1, {"input": 1})
    storage.transition_build(7, build["id"], "validating", None)
    failed = storage.fail_build(
        7, build["id"], "validation-failed", "invalid widget",
        [{"severity": "error", "code": "E_WIDGET"}],
    )
    assert failed["state"] == "failed"
    assert failed["failure"]["code"] == "validation-failed"
    with pytest.raises(storage.BuildStateError):
        storage.transition_build(7, build["id"], "validating", None)


def test_queue_build_resolves_and_freezes_all_revisions(tmp_path, monkeypatch):
    data_dir = tmp_path / "resolved"
    monkeypatch.setattr(catalog_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(catalog_db, "DB_PATH", data_dir / "catalog.db")
    monkeypatch.setattr(project_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(project_db, "DB_PATH", data_dir / "projects.db")
    monkeypatch.setattr(db, "DATA_DIR", data_dir)
    monkeypatch.setattr(db, "DB_PATH", data_dir / "builds.db")
    monkeypatch.setattr(db, "ARTIFACT_ROOT", data_dir / "artifacts")
    monkeypatch.setattr(asset_store, "DATA_DIR", data_dir)
    monkeypatch.setattr(asset_store, "DB_PATH", data_dir / "assets.db")
    monkeypatch.setattr(asset_store, "BLOB_ROOT", data_dir / "asset_blobs")

    snapshot = project_snapshot()
    controller = {
        "schemaVersion": 1,
        "kind": "controller-profile",
        "id": "controller:panel",
        "revision": 1,
        "model": "86-panel",
        "displayRef": "display:240x240-rgb565@1",
        "frame": {
            "assetRef": "asset:panel@sha256:12345678",
            "viewBox": {"x": 0, "y": 0, "width": 300, "height": 300},
            "screenViewport": {"x": 30, "y": 30, "width": 240, "height": 240, "rotation": 0},
        },
    }
    firmware = {
        "schemaVersion": 1,
        "kind": "firmware-profile",
        "id": "firmware:panel",
        "revision": 1,
        "target": "esp32s3",
        "uiAbiVersion": "1.0.0",
        "capabilityRevision": 1,
        "supportedWidgets": ["button", "label"],
        "supportedSubjects": ["bool", "int", "string"],
        "supportedActions": ["navigate", "set_subject"],
        "memoryBudgetBytes": 1048576,
    }
    target = {
        "schemaVersion": 1,
        "kind": "lvgl-build-target",
        "id": "target:panel",
        "revision": 1,
        "uiProjectRef": "ui:panel@1",
        "controllerProfileRef": "controller:panel@1",
        "themeRef": "ui:panel@1#theme:default",
        "firmwareProfileRef": "firmware:panel@1",
        "lvglVersion": "9.5.0",
    }
    snapshot["controllerProfile"] = controller
    snapshot["buildTarget"] = target
    for doc in (snapshot["displayProfile"], controller, firmware, target):
        catalog_db.publish_revision(7, 7, doc)
    project_db.create_project(7, "Panel", snapshot)

    queued = service.queue_build(7, 7, "target:panel", 1)
    assert queued["state"] == "queued"
    assert queued["inputLock"]["profiles"]["display"]["ref"] == "display:240x240-rgb565@1"
    assert queued["inputLock"]["profiles"]["firmware"]["ref"] == "firmware:panel@1"
    assert queued["inputLock"]["generator"]["lvglVersion"] == "9.5.0"
    assert queued["inputLock"]["generator"]["espIdfVersion"] == "5.4.4"
    assert len(queued["inputLock"]["generator"]["espIdfCommit"]) == 40
    assert queued["inputLock"]["generator"]["uiAbiVersion"] == "1.0.0"
    assert len(queued["inputLock"]["firmwareCapabilitySha256"]) == 64
    assert queued["inputLock"]["assets"] == []

    draft_target = dict(target)
    draft_target["revision"] = 2
    draft_target.pop("firmwareProfileRef")
    catalog_db.publish_revision(7, 7, draft_target)
    with pytest.raises(service.BuildInputError) as error:
        service.queue_build(7, 7, "target:panel", 2)
    assert error.value.code == "firmware-profile-required"

    base_theme = {
        "schemaVersion": 1,
        "kind": "lvgl-theme",
        "id": "theme:brand",
        "revision": 1,
        "tokens": [
            {"id": "color.background", "type": "color", "value": "#000000"},
            {"id": "color.text.primary", "type": "color", "value": "#111111"},
        ],
    }
    dark_theme = {
        "schemaVersion": 1,
        "kind": "lvgl-theme",
        "id": "theme:brand-dark",
        "revision": 1,
        "extends": "theme:brand@1",
        "tokens": [
            {"id": "color.text.primary", "type": "color", "value": "#ffffff"},
        ],
    }
    standalone_target = dict(target)
    standalone_target.update({
        "id": "target:standalone-theme",
        "themeRef": "theme:brand-dark@1",
    })
    catalog_db.publish_revision(7, 7, base_theme)
    catalog_db.publish_revision(7, 7, dark_theme)
    catalog_db.publish_revision(7, 7, standalone_target)
    standalone = service.queue_build(7, 7, "target:standalone-theme", 1)
    assert standalone["inputLock"]["profiles"]["theme"]["ref"] == "theme:brand-dark@1"
    assert standalone["inputLock"]["buildTarget"]["themeRef"] == "theme:brand-dark@1"
    resolved_tokens = {
        token["id"]: token["value"]
        for token in standalone["inputLock"]["uiProject"]["themes"][0]["tokens"]
    }
    assert resolved_tokens == {
        "color.background": "#000000",
        "color.text.primary": "#ffffff",
    }


def test_build_api_uses_separate_build_and_publish_permissions(monkeypatch):
    from app.routes import lvgl_builds
    from app.tools.auth import security

    granted = {"tool.lvgl.use"}
    monkeypatch.setattr(security, "users_exist", lambda: True)
    monkeypatch.setattr(
        security,
        "get_user_by_session",
        lambda session_id: {"id": 7, "username": "builder", "role": "user", "is_active": True}
        if session_id == "valid" else None,
    )
    monkeypatch.setattr(security, "get_effective_permissions", lambda _user: sorted(granted))
    monkeypatch.setattr(
        service,
        "queue_build",
        lambda *_args: {"id": "build-1", "state": "queued"},
    )

    api = FastAPI()
    api.include_router(lvgl_builds.router, prefix="/api/lvgl/builds")
    client = TestClient(api)
    client.cookies.set(auth_db.SESSION_COOKIE, "valid")
    request = {"buildTargetId": "target:panel", "buildTargetRevision": 1}

    assert client.post("/api/lvgl/builds", json=request).status_code == 403
    granted.add("tool.lvgl.build")
    queued = client.post("/api/lvgl/builds", json=request)
    assert queued.status_code == 202 and queued.json()["state"] == "queued"
    assert client.post("/api/lvgl/builds/build-1/approve").status_code == 403


def test_fixed_worker_protocol_completes_or_fails_build(isolated_builds, tmp_path, monkeypatch):
    worker = tmp_path / "fake_worker.py"
    worker.write_text(
        "import json,sys\n"
        "request=json.load(sys.stdin)\n"
        "print(json.dumps({'protocolVersion':1,'files':{'ui.c':'generated'},"
        "'diagnostics':request['inputLock'].get('diagnostics',[]),"
        "'generatorManifest':{'version':'fake'}}))\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "DEFAULT_WORKER_PATHS", (worker,))
    monkeypatch.setenv("LVGL_NODE_BINARY", sys.executable)
    monkeypatch.setattr(runner, "_worker_attestation", lambda *_args: {"runtimeSha256": "0" * 64})

    succeeded = isolated_builds.create_build(7, 7, "target:panel", 1, {"diagnostics": []})
    result = runner.run_build(7, succeeded["id"])
    assert result["state"] == "succeeded"
    assert isolated_builds.get_artifact(7, succeeded["id"])["fileCount"] == 3

    failed = isolated_builds.create_build(
        7, 7, "target:panel", 1,
        {"diagnostics": [{"severity": "error", "code": "E_TEST", "message": "blocked"}]},
    )
    result = runner.run_build(7, failed["id"])
    assert result["state"] == "failed"
    assert result["failure"]["code"] == "generator-diagnostics"


def test_runner_seals_version_locked_preview_host_and_program(isolated_builds, tmp_path, monkeypatch):
    worker = tmp_path / "preview_worker.py"
    worker.write_text(
        "import json,sys\n"
        "json.load(sys.stdin)\n"
        "print(json.dumps({'protocolVersion':1,'files':{"
        "'ui.c':'generated','preview/preview-program.json':'{\\\"protocolVersion\\\":1}'},"
        "'diagnostics':[],'generatorManifest':{'version':'fake','preview':{'protocolVersion':1}}}))\n",
        encoding="utf-8",
    )
    host = tmp_path / "preview-host"
    host.mkdir()
    (host / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (host / "preview-host.js").write_text("export {};", encoding="utf-8")
    (host / "lvgl_runtime.wasm").write_bytes(b"\x00asm")
    runtime_manifest = tmp_path / "runtime-manifest.json"
    runtime_manifest.write_text(
        '{"lvglVersion":"9.5.0","lvglCommit":"locked-commit",'
        '"lvConfSha256":"conf-hash","runtimeMode":"preview-program"}',
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "DEFAULT_WORKER_PATHS", (worker,))
    monkeypatch.setattr(runner, "DEFAULT_PREVIEW_HOST_PATHS", (host,))
    monkeypatch.setattr(runner, "DEFAULT_RUNTIME_MANIFEST_PATHS", (runtime_manifest,))
    monkeypatch.setenv("LVGL_NODE_BINARY", sys.executable)
    monkeypatch.setattr(runner, "_worker_attestation", lambda *_args: {"runtimeSha256": "0" * 64})

    build = isolated_builds.create_build(7, 7, "target:panel", 1, {
        "assets": [],
        "generator": {"lvglVersion": "9.5.0", "lvglCommit": "locked-commit"},
    })
    result = runner.run_build(7, build["id"])

    assert result["state"] == "succeeded"
    assert result["manifest"]["generator"]["sealedPreview"]["status"] == "sealed"
    artifact = isolated_builds.get_artifact(7, build["id"])
    with zipfile.ZipFile(artifact["path"]) as archive:
        assert {
            "preview/index.html",
            "preview/preview-host.js",
            "preview/lvgl_runtime.wasm",
            "preview/preview-program.json",
            "preview/runtime-build-manifest.json",
        }.issubset(archive.namelist())


def test_worker_rechecks_locked_asset_integrity_before_codegen(isolated_builds, tmp_path, monkeypatch):
    asset_dir = tmp_path / "assets"
    monkeypatch.setattr(asset_store, "DATA_DIR", asset_dir)
    monkeypatch.setattr(asset_store, "DB_PATH", asset_dir / "assets.db")
    monkeypatch.setattr(asset_store, "BLOB_ROOT", asset_dir / "blobs")
    payload = b"locked-image"
    sha256 = hashlib.sha256(payload).hexdigest()
    metadata, _created = asset_store.put_asset(7, sha256, payload, "logo.png", "image/png")
    build = isolated_builds.create_build(7, 7, "target:panel", 1, {
        "assets": [{"sha256": sha256, "byteSize": len(payload)}],
    })

    metadata["path"].write_bytes(b"tampered!!!!")
    result = runner.run_build(7, build["id"])

    assert result["state"] == "failed"
    assert result["failure"]["code"] == "asset-integrity-failed"


def test_runner_passes_verified_font_payload_to_trusted_worker(isolated_builds, tmp_path, monkeypatch):
    asset_dir = tmp_path / "font-assets"
    monkeypatch.setattr(asset_store, "DATA_DIR", asset_dir)
    monkeypatch.setattr(asset_store, "DB_PATH", asset_dir / "assets.db")
    monkeypatch.setattr(asset_store, "BLOB_ROOT", asset_dir / "blobs")
    payload = b"test-font-bytes"
    sha256 = hashlib.sha256(payload).hexdigest()
    asset_store.put_asset(7, sha256, payload, "font.ttf", "font/ttf")
    build = isolated_builds.create_build(7, 7, "target:panel", 1, {
        "assets": [{
            "category": "fonts", "id": "font:test", "codeName": "test",
            "sha256": sha256, "byteSize": len(payload),
            "conv": {"sizePx": 16, "bpp": 4, "ranges": "0x20-0x7e"},
        }],
    })
    captured = {}

    def fake_invoke(_input_lock, asset_payloads=None):
        captured.update(asset_payloads or {})
        return {
            "protocolVersion": 1,
            "files": {"ui.c": "generated", "fonts/test.c": "font"},
            "diagnostics": [],
            "generatorManifest": {"version": "fake", "convertedAssets": [{"id": "font:test"}]},
        }

    monkeypatch.setattr(runner, "_invoke", fake_invoke)
    result = runner.run_build(7, build["id"])

    assert result["state"] == "succeeded"
    assert base64.b64decode(captured[sha256]) == payload
    assert result["manifest"]["generator"]["convertedAssets"] == [{"id": "font:test"}]


def test_runner_records_compile_gate_failure_as_blocking_diagnostic(isolated_builds, monkeypatch):
    build = isolated_builds.create_build(7, 7, "target:panel", 1, {"assets": []})
    monkeypatch.setattr(runner, "_invoke", lambda *_args, **_kwargs: {
        "protocolVersion": 1,
        "files": {"ui.c": "generated"},
        "diagnostics": [],
        "generatorManifest": {"version": "fake"},
    })

    def reject(*_args, **_kwargs):
        raise compile_gate.CompileGateError("host-compile-failed", "generated source did not compile")

    monkeypatch.setattr(compile_gate, "validate_generated_sources", reject)
    result = runner.run_build(7, build["id"])

    assert result["state"] == "failed"
    assert result["failure"]["code"] == "host-compile-failed"
    assert result["diagnostics"] == [{
        "severity": "error",
        "code": "host-compile-failed",
        "message": "generated source did not compile",
    }]


def test_queue_leases_are_exclusive_and_expired_work_is_recovered(isolated_builds):
    first = isolated_builds.create_build(7, 7, "target:first", 1, {"input": 1})
    second = isolated_builds.create_build(8, 8, "target:second", 1, {"input": 2})

    claimed_first = isolated_builds.claim_next_build("worker-a", 10, now=100)
    claimed_second = isolated_builds.claim_next_build("worker-b", 10, now=100)
    assert claimed_first == {"id": first["id"], "ownerUserId": 7}
    assert claimed_second == {"id": second["id"], "ownerUserId": 8}
    assert isolated_builds.acquire_build_lease(first["id"], "worker-b", 10, now=101) is False

    isolated_builds.transition_build(7, first["id"], "validating", None)
    assert isolated_builds.recover_abandoned_builds(now=105) == 0
    assert isolated_builds.recover_abandoned_builds(now=111) == 1
    recovered = isolated_builds.get_build(7, first["id"])
    assert recovered["state"] == "failed"
    assert recovered["failure"]["code"] == "worker-interrupted"

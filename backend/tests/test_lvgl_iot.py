import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import lvgl_iot
from app.tools.lvgl_builds import db as build_db
from app.tools.lvgl_builds.capability import (
    FirmwareCapabilityError,
    canonical_firmware_capability,
    capability_sha256,
)
from app.tools.lvgl_iot import db as integration_db


@pytest.fixture()
def iot_api(tmp_path, monkeypatch):
    data_dir = tmp_path / "iot"
    monkeypatch.setattr(build_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(build_db, "DB_PATH", data_dir / "builds.db")
    monkeypatch.setattr(build_db, "ARTIFACT_ROOT", data_dir / "artifacts")
    monkeypatch.setattr(integration_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(integration_db, "DB_PATH", data_dir / "integrations.db")
    build_db.init_db()
    integration_db.init_db()

    app = FastAPI()
    app.include_router(lvgl_iot.router, prefix="/api/integrations/iot/v1")
    return TestClient(app)


def _input_lock():
    capability = {
        "schemaVersion": 1,
        "uiAbiVersion": "1.0.0",
        "capabilityRevision": 4,
        "target": "esp32s3",
        "lvglVersion": "9.5.0",
        "supportedWidgets": ["button", "label"],
        "supportedSubjects": ["bool", "int"],
        "supportedActions": ["navigate"],
    }
    return {
        "formatVersion": 1,
        "generator": {
            "version": "@lvd/codegen@0.1.0",
            "lvglVersion": "9.5.0",
            "uiAbiVersion": "1.0.0",
        },
        "firmwareCapability": capability,
        "firmwareCapabilitySha256": capability_sha256(capability),
        "buildTarget": {"uiProjectRef": "ui:panel@7"},
    }


def _headers(token, tenant="iot-tenant-a"):
    return {"Authorization": f"Bearer {token}", "X-IoT-Tenant": tenant}


def test_firmware_capability_hash_is_canonical_and_abi_gated():
    profile = {
        "target": "esp32s3",
        "uiAbiVersion": "1.0.0",
        "capabilityRevision": 4,
        "supportedWidgets": ["label", "button", "button"],
        "supportedSubjects": ["int", "bool"],
        "supportedActions": ["navigate"],
    }
    first = canonical_firmware_capability(profile, "9.5.0")
    reordered = dict(profile, supportedWidgets=["button", "label"])
    assert capability_sha256(first) == capability_sha256(
        canonical_firmware_capability(reordered, "9.5.0"),
    )
    assert first["supportedWidgets"] == ["button", "label"]

    incompatible = dict(profile, uiAbiVersion="2.0.0")
    with pytest.raises(FirmwareCapabilityError) as error:
        canonical_firmware_capability(incompatible, "9.5.0")
    assert error.value.code == "ui-abi-incompatible"


def test_m2m_auth_maps_tenant_and_never_accepts_browser_cookie(iot_api):
    client_record, token = integration_db.create_service_client(
        "iot-backend", ["lvgl.build.read", "lvgl.artifact.read", "lvgl.preview.read"],
    )
    integration_db.set_tenant_mapping(client_record["id"], "iot-tenant-a", 7)
    build = build_db.create_build(7, 7, "target:panel", 3, _input_lock())
    foreign = build_db.create_build(8, 8, "target:foreign", 1, _input_lock())

    url = f"/api/integrations/iot/v1/builds/{build['id']}"
    assert iot_api.get(url, cookies={"session_id": token}).status_code == 401
    assert iot_api.get(url, headers=_headers(token, "unknown-tenant")).status_code == 401
    assert iot_api.get(f"/api/integrations/iot/v1/builds/{foreign['id']}", headers=_headers(token)).status_code == 404

    response = iot_api.get(url, headers=_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert body["apiVersion"] == "iot.lvgl/v1"
    assert body["uiProjectRevision"] == 7
    assert body["buildTargetRevision"] == 3
    assert body["firmwareCapabilitySha256"] == _input_lock()["firmwareCapabilitySha256"]
    assert body["manifestUrl"].endswith(f"/builds/{build['id']}/manifest")
    assert body["previewUrl"].endswith(f"/builds/{build['id']}/preview")
    assert "owner" not in response.text.lower()
    assert "inputLock" not in response.text


def test_stable_manifest_artifact_preview_and_versioned_openapi(iot_api):
    client_record, token = integration_db.create_service_client(
        "iot-backend", ["lvgl.build.read", "lvgl.artifact.read", "lvgl.preview.read"],
    )
    integration_db.set_tenant_mapping(client_record["id"], "iot-tenant-a", 7)
    build = build_db.create_build(7, 7, "target:panel", 3, _input_lock())
    build_db.transition_build(7, build["id"], "validating", None)
    build_db.transition_build(7, build["id"], "building", None)
    completed = build_db.complete_build(
        7,
        build["id"],
        {
            "ui.c": "void ui_init(void) {}\n",
            "preview/index.html": "<!doctype html><script type=module src=./preview-host.js></script>",
            "preview/preview-host.js": "fetch('./preview-program.json')",
            "preview/lvgl_runtime.wasm": b"\x00asm-test",
            "preview/preview-program.json": '{"protocolVersion":1}',
        },
        [],
        {
            "version": "test",
            "sealedPreview": {"status": "sealed", "entrypoint": "preview/index.html"},
        },
    )
    artifact = build_db.get_artifact(7, build["id"])

    base = f"/api/integrations/iot/v1/builds/{build['id']}"
    manifest = iot_api.get(f"{base}/manifest", headers=_headers(token))
    assert manifest.status_code == 200
    assert manifest.json()["inputs"]["uiAbiVersion"] == "1.0.0"
    assert manifest.json()["inputs"]["firmwareCapabilitySha256"] == _input_lock()["firmwareCapabilitySha256"]
    assert manifest.headers["cache-control"] == "private, immutable"

    zipped = iot_api.get(f"{base}/artifact", headers=_headers(token))
    assert zipped.status_code == 200
    assert hashlib.sha256(zipped.content).hexdigest() == artifact["sha256"]
    build_dto = iot_api.get(base, headers=_headers(token)).json()
    assert build_dto["previewAvailable"] is True
    preview = iot_api.get(f"{base}/preview", headers=_headers(token))
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "text/html; charset=utf-8"
    assert preview.headers["content-security-policy"].startswith("default-src 'self'")
    assert "preview-host.js" in preview.text
    program = iot_api.get(f"{base}/preview/preview-program.json", headers=_headers(token))
    assert program.status_code == 200
    assert program.json()["protocolVersion"] == 1
    assert program.headers["etag"]

    contract = iot_api.get("/api/integrations/iot/v1/openapi.json")
    assert contract.status_code == 200
    assert contract.json()["info"]["version"] == "1.0.0"
    assert base.replace(build["id"], "{build_id}") in contract.json()["paths"]
    assert all(path.startswith("/api/integrations/iot/v1") for path in contract.json()["paths"])


def test_service_token_rotation_and_scope_enforcement(iot_api):
    record, old_token = integration_db.create_service_client("reader", ["lvgl.build.read"])
    integration_db.set_tenant_mapping(record["id"], "iot-tenant-a", 7)
    build = build_db.create_build(7, 7, "target:panel", 3, _input_lock())
    base = f"/api/integrations/iot/v1/builds/{build['id']}"

    assert iot_api.get(f"{base}/artifact", headers=_headers(old_token)).status_code == 403
    new_token = integration_db.rotate_service_token(record["id"])
    assert iot_api.get(base, headers=_headers(old_token)).status_code == 401
    assert iot_api.get(base, headers=_headers(new_token)).status_code == 200


def test_exchange_records_are_owner_scoped_immutable_and_idempotent(iot_api):
    record, token = integration_db.create_service_client(
        "iot-writer", ["lvgl.exchange.write", "lvgl.exchange.read"],
    )
    integration_db.set_tenant_mapping(record["id"], "iot-tenant-a", 7)
    build = build_db.create_build(7, 7, "target:panel", 3, _input_lock())
    url = "/api/integrations/iot/v1/exchanges"
    body = {
        "apiVersion": "iot.lvgl/v1",
        "eventType": "build.associated",
        "uiBuildId": build["id"],
        "externalRef": "firmware:production-17",
        "occurredAt": "2026-09-11T02:00:00Z",
        "details": {"modelId": "86-panel"},
    }
    headers = {**_headers(token), "Idempotency-Key": "associate:production-17"}

    created = iot_api.post(url, json=body, headers=headers)
    assert created.status_code == 200
    assert created.json()["duplicate"] is False

    retry = iot_api.post(url, json=body, headers=headers)
    assert retry.status_code == 200
    assert retry.json()["duplicate"] is True
    assert retry.json()["exchangeId"] == created.json()["exchangeId"]

    changed = dict(body, externalRef="firmware:different")
    conflict = iot_api.post(url, json=changed, headers=headers)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency-conflict"

    listed = iot_api.get(url, headers=_headers(token))
    assert listed.status_code == 200
    assert len(listed.json()["exchanges"]) == 1
    assert listed.json()["exchanges"][0]["uiBuildId"] == build["id"]

    assert iot_api.post(url, json=body, headers=_headers(token)).status_code == 422
    foreign = build_db.create_build(8, 8, "target:foreign", 1, _input_lock())
    foreign_body = dict(body, uiBuildId=foreign["id"])
    assert iot_api.post(url, json=foreign_body, headers={
        **_headers(token), "Idempotency-Key": "associate:foreign-build",
    }).status_code == 404

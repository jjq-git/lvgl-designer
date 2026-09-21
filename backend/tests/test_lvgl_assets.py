import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import lvgl_assets
from app.tools.auth import db as auth_db
from app.tools.lvgl_assets import store


@pytest.fixture()
def isolated_assets(tmp_path, monkeypatch):
    data_dir = tmp_path / "lvgl"
    monkeypatch.setattr(store, "DATA_DIR", data_dir)
    monkeypatch.setattr(store, "DB_PATH", data_dir / "assets.db")
    monkeypatch.setattr(store, "BLOB_ROOT", data_dir / "asset_blobs")
    store.init_db()
    return store


def test_asset_cas_deduplicates_bytes_but_keeps_owner_boundaries(isolated_assets):
    payload = b"\x89PNG\r\n\x1a\ncontent"
    sha256 = hashlib.sha256(payload).hexdigest()

    first, first_created = isolated_assets.put_asset(7, sha256, payload, "logo.png", "image/png")
    second, second_created = isolated_assets.put_asset(8, sha256, payload, "brand.png", "image/png")

    assert first_created is True
    assert second_created is True
    assert first["path"] == second["path"]
    assert len(list(isolated_assets.BLOB_ROOT.rglob(sha256))) == 1
    assert isolated_assets.get_asset(7, sha256)["fileName"] == "logo.png"
    assert isolated_assets.get_asset(8, sha256)["fileName"] == "brand.png"
    assert isolated_assets.get_asset(9, sha256) is None

    _, repeated_created = isolated_assets.put_asset(7, sha256, payload, "logo-new.png", "image/png")
    assert repeated_created is False
    assert isolated_assets.get_asset(7, sha256)["fileName"] == "logo-new.png"


def test_asset_cas_rejects_hash_size_and_path_tampering(isolated_assets):
    payload = b"asset"
    sha256 = hashlib.sha256(payload).hexdigest()
    with pytest.raises(store.AssetStoreError) as mismatch:
        isolated_assets.put_asset(7, "0" * 64, payload, "asset.bin")
    assert mismatch.value.code == "asset-sha256-mismatch"

    with pytest.raises(store.AssetStoreError) as unsafe_name:
        isolated_assets.put_asset(7, sha256, payload, "../asset.bin")
    assert unsafe_name.value.code == "invalid-asset-file-name"

    isolated_assets.put_asset(7, sha256, payload, "asset.bin")
    with pytest.raises(store.AssetStoreError) as size:
        isolated_assets.read_verified(7, sha256, expected_size=len(payload) + 1)
    assert size.value.code == "asset-size-mismatch"

    isolated_assets.get_asset(7, sha256)["path"].write_bytes(b"corrupt")
    with pytest.raises(store.AssetStoreError) as corrupt:
        isolated_assets.read_verified(7, sha256)
    assert corrupt.value.code == "asset-integrity-failed"


def test_asset_api_verifies_upload_and_enforces_owner_scope(isolated_assets, monkeypatch):
    from app.tools.auth import security

    current_user = {"id": 7, "username": "designer", "role": "user", "is_active": True}
    monkeypatch.setattr(security, "users_exist", lambda: True)
    monkeypatch.setattr(security, "get_user_by_session", lambda session_id: current_user if session_id == "valid" else None)
    monkeypatch.setattr(security, "get_effective_permissions", lambda _user: ["tool.lvgl.use"])

    api = FastAPI()
    api.include_router(lvgl_assets.router, prefix="/api/lvgl/assets")
    client = TestClient(api)
    client.cookies.set(auth_db.SESSION_COOKIE, "valid")

    payload = b"asset-api"
    sha256 = hashlib.sha256(payload).hexdigest()
    uploaded = client.put(
        f"/api/lvgl/assets/{sha256}?fileName=logo.png",
        content=payload,
        headers={"content-type": "image/png"},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["sha256"] == sha256
    assert client.get(f"/api/lvgl/assets/{sha256}").content == payload
    assert client.get("/api/lvgl/assets").json()["assets"][0]["fileName"] == "logo.png"

    current_user["id"] = 8
    assert client.get(f"/api/lvgl/assets/{sha256}").status_code == 404
    bad = client.put(
        f"/api/lvgl/assets/{'0' * 64}?fileName=logo.png",
        content=payload,
        headers={"content-type": "image/png"},
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "asset-sha256-mismatch"


def test_project_asset_locks_are_stable_and_require_uploaded_bytes(isolated_assets):
    payload = b"image-bytes"
    sha256 = hashlib.sha256(payload).hexdigest()
    ui = {
        "assets": {
            "fonts": [],
            "images": [{
                "id": "image:logo",
                "codeName": "logo",
                "file": {"fileName": "logo.png", "sha256": sha256, "byteSize": len(payload)},
                "conv": {"colorFormat": "RGB565"},
            }],
            "icons": [],
        },
    }
    with pytest.raises(store.AssetStoreError) as missing:
        isolated_assets.lock_project_assets(7, ui)
    assert missing.value.code == "asset-not-found"

    isolated_assets.put_asset(7, sha256, payload, "logo.png", "image/png")
    assert isolated_assets.lock_project_assets(7, ui) == [{
        "category": "images",
        "id": "image:logo",
        "codeName": "logo",
        "displayName": None,
        "fileName": "logo.png",
        "sha256": sha256,
        "byteSize": len(payload),
        "conv": {"colorFormat": "RGB565"},
    }]

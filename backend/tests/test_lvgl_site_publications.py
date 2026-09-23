import json
import uuid

import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import lvgl_site_publications as routes
from app.tools.auth import db as auth_db
from app.tools.auth import security
from app.tools.lvgl_projects import db as project_db
from app.tools.lvgl_site_publications import db, git_target, service


def snapshot():
    return {
        "kind": "lvgl-project-snapshot",
        "snapshotVersion": 1,
        "uiProject": {"meta": {"revision": 3}},
    }


@pytest.fixture()
def isolated_publications(tmp_path, monkeypatch):
    project_dir = tmp_path / "projects"
    publication_dir = tmp_path / "publications"
    monkeypatch.setattr(project_db, "DATA_DIR", project_dir)
    monkeypatch.setattr(project_db, "DB_PATH", project_dir / "projects.db")
    monkeypatch.setattr(db, "DATA_DIR", publication_dir)
    monkeypatch.setattr(db, "DB_PATH", publication_dir / "publications.db")
    monkeypatch.setattr(db, "ARTIFACT_ROOT", publication_dir / "artifacts")
    project_db.init_db()
    db.init_db()
    return tmp_path


def target_state(public=True):
    return {
        "targetCommit": "a" * 40,
        "branch": "main",
        "frames": [{"id": "WF2D-8620", "model": "WF2D-8620", "resolution": {"width": 240, "height": 240}, "shape": "round"}],
        "demos": [{"id": "11111111-1111-4111-8111-111111111111", "frameId": "WF2D-8620", "name": "Existing", "description": "kept", "isPublic": public}],
    }


def install_fakes(monkeypatch):
    monkeypatch.setattr(git_target, "read_state", lambda: target_state())
    monkeypatch.setattr(git_target, "configuration", lambda: ("https://secret@example.test/wf2/site.git", "main"))
    monkeypatch.setattr(service.worker, "project", lambda _snapshot: {
        "json": "{}", "sha256": "2" * 64, "diagnostics": [], "document": {},
    })

    def fake_prepare(record, _document, artifact_dir):
        artifact_dir.mkdir(parents=True)
        (artifact_dir / "document.json").write_text("{}", encoding="utf-8")
        (artifact_dir / "thumbnail.png").write_bytes(b"png")
        (artifact_dir / "plan.json").write_text("{}", encoding="utf-8")
        return {
            "documentSha256": "2" * 64, "thumbnailSha256": "3" * 64,
            "targetBaseCommit": "a" * 40, "changedPaths": ["site/ui_list.json"],
            "diagnostics": [], "diffStat": "1 file changed",
        }

    monkeypatch.setattr(git_target, "prepare", fake_prepare)


def test_prepare_locks_cloud_revision_and_defaults_new_demo_hidden(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    prepared = service.prepare(
        7, 9, project_id=project["id"], frame_id="WF2D-8620", name="New",
        description="", is_public=None, demo_id=None,
    )
    assert prepared["status"] == "prepared"
    assert prepared["isPublic"] is False
    assert prepared["sourceProjectVersion"] == 1
    assert prepared["sourceSnapshotSeq"] == 1
    assert prepared["sourceUiRevision"] == 3
    assert prepared["demoId"] != prepared["id"]
    assert len(project_db.list_versions(7, project["id"])) == 1
    assert prepared["targetRepo"] == "https://example.test/wf2/site.git"


def test_update_binding_is_explicit_and_retains_visibility(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    demo_id = target_state()["demos"][0]["id"]
    prepared = service.prepare(
        7, 7, project_id=project["id"], frame_id="WF2D-8620", name="Updated",
        description="kept", is_public=None, demo_id=demo_id,
    )
    assert prepared["demoId"] == demo_id
    assert prepared["isPublic"] is True


def test_semantic_merge_preserves_order_and_unknown_fields():
    listing = {
        "schemaVersion": 1,
        "future": {"keep": True},
        "items": [
            {"id": "a", "name": "first", "futureField": 9},
            {"id": "b", "name": "old", "frameId": "OLD", "isPublic": True},
        ],
    }
    previous = dict(listing["items"][1])
    record = {"demoId": "b", "frameId": "WF2D-8620", "name": "new", "description": "d", "isPublic": False}
    git_target._merge_item(listing, record, "uis/new.json", "uis/new.png", previous)
    assert [item["id"] for item in listing["items"]] == ["a", "b"]
    assert listing["items"][0]["futureField"] == 9
    assert listing["items"][1]["documentUrl"] == "uis/new.json"
    assert listing["future"] == {"keep": True}


def test_frame_gate_requires_registered_resolution_and_shape():
    document = {"displayProfile": {"logicalSize": {"width": 480, "height": 480}, "shape": "rect"}}
    frame = {"id": "WF2D-8620", "resolution": {"width": 240, "height": 240}, "match": {"shape": "round"}}
    codes = {item["code"] for item in git_target.validate_frame(document, frame)}
    assert codes == {"E_FRAME_SHAPE_MISMATCH", "E_FRAME_RESOLUTION_MISMATCH"}


def test_publish_is_idempotent_at_database_boundary(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    prepared = service.prepare(7, 7, project_id=project["id"], frame_id="WF2D-8620", name="New", description="", is_public=False, demo_id=None)
    calls = []
    monkeypatch.setattr(git_target, "publish", lambda *_args: calls.append(1) or {"commitSha": "c" * 40, "changedPaths": [], "idempotent": False})
    first = service.publish(7, 7, prepared["id"])
    second = service.publish(7, 7, prepared["id"])
    assert first["commitSha"] == second["commitSha"] == "c" * 40
    assert len(calls) == 1
    assert first["deploymentStatus"] == "git_submitted"
    assert first["delivery"]["git"]["status"] == "submitted"
    assert first["delivery"]["staticUpload"]["status"] == "not_started"


def test_deployment_callback_is_authenticated_and_persisted(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    prepared = service.prepare(
        7, 7, project_id=project["id"], frame_id="WF2D-8620", name="Deploy",
        description="", is_public=False, demo_id=None,
    )
    commit_sha = "d" * 40
    monkeypatch.setattr(
        git_target, "publish",
        lambda *_args: {"commitSha": commit_sha, "changedPaths": [], "idempotent": False},
    )
    service.publish(7, 7, prepared["id"])
    token = "callback-token-with-at-least-32-characters"
    monkeypatch.setenv("LVGL_PODSC_DEPLOY_CALLBACK_TOKEN", token)
    api = FastAPI()
    api.include_router(routes.router, prefix="/api/lvgl/site-publications")
    client = TestClient(api)
    payload = {
        "commitSha": commit_sha, "stage": "staticUpload", "status": "succeeded",
        "detail": "uploaded 12 files",
    }
    assert client.post("/api/lvgl/site-publications/deployment-callback", json=payload).status_code == 401
    response = client.post(
        "/api/lvgl/site-publications/deployment-callback", json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["delivery"]["staticUpload"]["status"] == "succeeded"
    stored = service.get(7, prepared["id"])
    assert stored["delivery"]["staticUpload"]["detail"] == "uploaded 12 files"
    assert stored["deploymentStatus"] == "deploying"
    for stage in ("stalePageDeletion", "cdnRefresh"):
        response = client.post(
            "/api/lvgl/site-publications/deployment-callback",
            json={"commitSha": commit_sha, "stage": stage, "status": "succeeded"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
    assert response.json()["deploymentStatus"] == "deployed"


def test_rollback_resets_delivery_and_rejects_superseded_commit(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    prepared = service.prepare(
        7, 7, project_id=project["id"], frame_id="WF2D-8620", name="Rollback",
        description="", is_public=False, demo_id=None,
    )
    original_sha = "c" * 40
    rollback_sha = "b" * 40
    monkeypatch.setattr(
        git_target, "publish",
        lambda *_args: {"commitSha": original_sha, "changedPaths": [], "idempotent": False},
    )
    service.publish(7, 7, prepared["id"])
    service.record_deployment(original_sha, "staticUpload", "succeeded")
    monkeypatch.setattr(
        git_target, "rollback",
        lambda *_args: {"commitSha": rollback_sha, "changedPaths": [], "idempotent": False},
    )
    rolled_back = service.rollback(7, 7, prepared["id"])
    assert rolled_back["delivery"]["git"] == {"status": "rolled_back", "commitSha": rollback_sha}
    assert rolled_back["delivery"]["staticUpload"]["status"] == "not_started"
    assert service.rollback(7, 7, prepared["id"])["deploymentStatus"] == "git_submitted"
    with pytest.raises(service.PublicationError) as exc_info:
        service.record_deployment(original_sha, "cdnRefresh", "succeeded")
    assert exc_info.value.status_code == 409
    assert service.record_deployment(rollback_sha, "staticUpload", "running")["deploymentStatus"] == "deploying"


def test_deployment_callback_rejects_unknown_commit(isolated_publications, monkeypatch):
    token = "callback-token-with-at-least-32-characters"
    monkeypatch.setenv("LVGL_PODSC_DEPLOY_CALLBACK_TOKEN", token)
    api = FastAPI()
    api.include_router(routes.router, prefix="/api/lvgl/site-publications")
    client = TestClient(api)
    response = client.post(
        "/api/lvgl/site-publications/deployment-callback",
        json={"commitSha": "e" * 40, "stage": "cdnRefresh", "status": "running"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


def test_prepare_request_id_is_idempotent(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    request_id = str(uuid.uuid4())
    first = service.prepare(
        7, 7, project_id=project["id"], frame_id="WF2D-8620", name="New",
        description="", is_public=False, demo_id=None, request_id=request_id,
    )
    second = service.prepare(
        7, 7, project_id=project["id"], frame_id="WF2D-8620", name="New",
        description="", is_public=False, demo_id=None, request_id=request_id,
    )
    assert first["id"] == second["id"]
    assert first["demoId"] == second["demoId"]
    assert len(db.list_for_project(7, project["id"])) == 1


def test_publish_recovers_after_push_succeeded_before_receipt_was_saved(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    prepared = service.prepare(
        7, 9, project_id=project["id"], frame_id="WF2D-8620", name="Recover",
        description="", is_public=False, demo_id=None, request_id=str(uuid.uuid4()),
    )
    calls = []
    monkeypatch.setattr(
        git_target, "publish",
        lambda *_args: calls.append(1) or {
            "commitSha": "c" * 40, "changedPaths": [], "idempotent": len(calls) > 1,
        },
    )
    real_transition = db.transition
    crashed = False

    def crash_once(owner, actor, publication_id, status, **kwargs):
        nonlocal crashed
        if status == "git_committed" and not crashed:
            crashed = True
            raise RuntimeError("simulated crash after push")
        return real_transition(owner, actor, publication_id, status, **kwargs)

    monkeypatch.setattr(db, "transition", crash_once)
    with pytest.raises(RuntimeError):
        service.publish(7, 9, prepared["id"])
    assert db.get(7, prepared["id"])["status"] == "publishing"
    monkeypatch.setattr(db, "transition", real_transition)
    recovered = service.publish(7, 9, prepared["id"])
    assert recovered["status"] == "git_committed"
    assert recovered["commitSha"] == "c" * 40
    assert len(calls) == 2


def test_blank_thumbnail_is_rejected(tmp_path):
    image_path = tmp_path / "blank.png"
    Image.new("RGBA", (240, 240), (245, 245, 245, 255)).save(image_path)
    document = {
        "uiProject": {"screens": [{"isHome": True, "root": {"type": "obj", "children": []}}]},
    }
    with pytest.raises(git_target.TargetError) as error:
        git_target._assert_thumbnail_content(image_path, document)
    assert error.value.code == "thumbnail-blank"

    visible_path = tmp_path / "visible.png"
    visible = Image.new("RGBA", (240, 240), (245, 245, 245, 255))
    for x in range(60, 180):
        for y in range(100, 140):
            visible.putpixel((x, y), (32, 140, 230, 255))
    visible.save(visible_path)
    document["uiProject"]["screens"][0]["root"]["children"] = [{"type": "button", "children": []}]
    git_target._assert_thumbnail_content(visible_path, document)


def test_publish_rejects_when_project_changed_after_prepare(isolated_publications, monkeypatch):
    install_fakes(monkeypatch)
    project = project_db.create_project(7, "Panel", snapshot())
    prepared = service.prepare(7, 7, project_id=project["id"], frame_id="WF2D-8620", name="New", description="", is_public=False, demo_id=None)
    changed = snapshot()
    changed["uiProject"]["meta"]["revision"] = 4
    project_db.update_project(7, project["id"], changed, base_version=1)
    with pytest.raises(service.PublicationError) as error:
        service.publish(7, 7, prepared["id"])
    assert error.value.code == "prepared-source-expired"


def test_site_publication_api_requires_publish_permission(monkeypatch, tmp_path):
    granted = {"tool.lvgl.use"}
    monkeypatch.setattr(security, "users_exist", lambda: True)
    monkeypatch.setattr(
        security,
        "get_user_by_session",
        lambda session_id: {"id": 7, "username": "publisher", "role": "user", "is_active": True}
        if session_id == "valid" else None,
    )
    monkeypatch.setattr(security, "get_effective_permissions", lambda _user: sorted(granted))
    monkeypatch.setattr(service, "frames", lambda: target_state())
    api = FastAPI()
    api.include_router(routes.router, prefix="/api/lvgl/site-publications")
    client = TestClient(api)
    client.cookies.set(auth_db.SESSION_COOKIE, "valid")
    assert client.get("/api/lvgl/site-publications/frames").status_code == 403
    granted.add("tool.lvgl.publish")
    response = client.get("/api/lvgl/site-publications/frames")
    assert response.status_code == 200
    assert response.json()["frames"][0]["id"] == "WF2D-8620"

    document = tmp_path / "document.json"
    renderer = tmp_path / "renderer.js"
    styles = tmp_path / "styles.css"
    document.write_text('{"kind":"wf2-web-ui"}', encoding="utf-8")
    renderer.write_text("export const createWebUiRenderer=()=>({});", encoding="utf-8")
    styles.write_text("body{color:#000}", encoding="utf-8")
    monkeypatch.setattr(service, "preview", lambda *_args: (document, renderer, styles))
    preview = client.get("/api/lvgl/site-publications/00000000-0000-4000-8000-000000000000/preview")
    assert preview.status_code == 200
    assert "sandbox allow-scripts" in preview.headers["content-security-policy"]
    assert "globalThis.__renderer" in preview.text

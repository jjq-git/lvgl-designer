from fastapi.testclient import TestClient

from app import create_app
from app.tools.auth import db as auth_db
from app.tools.auth.security import AuthUser, require_login


def _authenticated_app(monkeypatch, permissions, designer_dir, datasheets_dir):
    monkeypatch.setenv("LVD_STATIC_DIR", str(designer_dir))
    monkeypatch.setenv("DATASHEETS_STATIC_DIR", str(datasheets_dir))
    user = {"id": 1, "username": "admin", "display_name": "Admin", "role": "admin"}
    monkeypatch.setattr(auth_db, "get_user_by_session", lambda _session: user)
    monkeypatch.setattr(auth_db, "get_effective_permissions", lambda _user: list(permissions))
    app = create_app()

    async def logged_in_user():
        return AuthUser({**user, "permissions": list(permissions)})

    app.dependency_overrides[require_login] = logged_in_user
    return app


def test_svg_static_assets_use_browser_decodable_media_type(tmp_path, monkeypatch):
    designer_dir = tmp_path / "designer"
    datasheets_dir = tmp_path / "datasheets"
    designer_dir.mkdir()
    datasheets_dir.mkdir()
    (designer_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (datasheets_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (designer_dir / "frame.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        encoding="utf-8",
    )
    app = _authenticated_app(
        monkeypatch,
        {"tool.lvgl.use", "tool.datasheet.use"},
        designer_dir,
        datasheets_dir,
    )

    with TestClient(app) as client:
        client.cookies.set(auth_db.SESSION_COOKIE, "test-session")
        response = client.get("/lvgl-designer/frame.svg")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"


def test_portal_lists_and_serves_both_authorized_apps(tmp_path, monkeypatch):
    designer_dir = tmp_path / "designer"
    datasheets_dir = tmp_path / "datasheets"
    designer_dir.mkdir()
    datasheets_dir.mkdir()
    (designer_dir / "index.html").write_text("designer", encoding="utf-8")
    (datasheets_dir / "index.html").write_text("datasheets", encoding="utf-8")
    app = _authenticated_app(
        monkeypatch,
        {"tool.lvgl.use", "tool.datasheet.use"},
        designer_dir,
        datasheets_dir,
    )

    with TestClient(app) as client:
        client.cookies.set(auth_db.SESSION_COOKIE, "test-session")
        portal = client.get("/", headers={"accept": "text/html"})
        designer = client.get("/lvgl-designer/", headers={"accept": "text/html"})
        datasheets = client.get("/datasheets/", headers={"accept": "text/html"})
        catalog = client.get("/api/apps").json()

    assert portal.status_code == 200
    assert "应用导航" in portal.text
    assert designer.text == "designer"
    assert datasheets.text == "datasheets"
    assert [item["id"] for item in catalog["apps"]] == ["lvgl-designer", "datasheets"]


def test_unauthenticated_deep_link_returns_to_same_app_after_login(tmp_path, monkeypatch):
    designer_dir = tmp_path / "designer"
    datasheets_dir = tmp_path / "datasheets"
    designer_dir.mkdir()
    datasheets_dir.mkdir()
    (designer_dir / "index.html").write_text("designer", encoding="utf-8")
    (datasheets_dir / "index.html").write_text("datasheets", encoding="utf-8")
    monkeypatch.setenv("LVD_STATIC_DIR", str(designer_dir))
    monkeypatch.setenv("DATASHEETS_STATIC_DIR", str(datasheets_dir))
    monkeypatch.setattr(auth_db, "get_user_by_session", lambda _session: None)

    with TestClient(create_app()) as client:
        response = client.get(
            "/datasheets/index.html",
            headers={"accept": "text/html"},
            follow_redirects=False,
        )

    assert response.status_code == 303
    assert response.headers["location"] == "/login?next=%2Fdatasheets%2Findex.html"

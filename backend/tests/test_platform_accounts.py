from fastapi.testclient import TestClient

from app import create_app
from app.tools.auth import db as auth_db


def _isolated_app(tmp_path, monkeypatch):
    auth_dir = tmp_path / "auth"
    designer_dir = tmp_path / "designer"
    datasheets_dir = tmp_path / "datasheets"
    designer_dir.mkdir()
    datasheets_dir.mkdir()
    (designer_dir / "index.html").write_text("designer", encoding="utf-8")
    (datasheets_dir / "index.html").write_text("datasheets", encoding="utf-8")
    monkeypatch.setattr(auth_db, "AUTH_DATA_DIR", auth_dir)
    monkeypatch.setattr(auth_db, "DB_PATH", auth_dir / "auth.db")
    monkeypatch.setenv("AUTH_BOOTSTRAP_ADMIN", "")
    monkeypatch.setenv("AUTH_BOOTSTRAP_PASSWORD", "")
    monkeypatch.setenv("LVD_STATIC_DIR", str(designer_dir))
    monkeypatch.setenv("DATASHEETS_STATIC_DIR", str(datasheets_dir))
    auth_db.init_db()
    admin = auth_db.create_user("admin", "admin-password", "admin", "Administrator")
    user = auth_db.create_user("viewer", "viewer-password", "user", "Viewer")
    return create_app(), admin, user


def test_account_pages_require_login_and_admin_permission(tmp_path, monkeypatch):
    app, _admin, _user = _isolated_app(tmp_path, monkeypatch)

    with TestClient(app) as anonymous:
        account = anonymous.get("/account", headers={"accept": "text/html"}, follow_redirects=False)
        users = anonymous.get("/admin/users", headers={"accept": "text/html"}, follow_redirects=False)
    assert account.status_code == 303
    assert account.headers["location"] == "/login?next=%2Faccount"
    assert users.status_code == 303
    assert users.headers["location"] == "/login?next=%2Fadmin%2Fusers"

    with TestClient(app) as viewer:
        assert viewer.post("/api/auth/login", json={"username": "viewer", "password": "viewer-password"}).status_code == 200
        assert viewer.get("/account", headers={"accept": "text/html"}).status_code == 200
        forbidden = viewer.get("/admin/users", headers={"accept": "text/html"})
        assert forbidden.status_code == 403

    with TestClient(app) as admin:
        assert admin.post("/api/auth/login", json={"username": "admin", "password": "admin-password"}).status_code == 200
        assert admin.get("/account", headers={"accept": "text/html"}).status_code == 200
        assert admin.get("/admin/users", headers={"accept": "text/html"}).status_code == 200
        assert admin.get("/admin/roles", headers={"accept": "text/html"}).status_code == 200


def test_admin_user_permissions_and_login_audit(tmp_path, monkeypatch):
    app, admin_user, _viewer = _isolated_app(tmp_path, monkeypatch)

    with TestClient(app) as client:
        failed = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert failed.status_code == 401
        logged_in = client.post("/api/auth/login", json={"username": "admin", "password": "admin-password"})
        assert logged_in.status_code == 200

        created = client.post(
            "/api/admin/users",
            json={
                "username": "operator",
                "password": "operator-password",
                "role": "user",
                "display_name": "Operator",
            },
        )
        assert created.status_code == 200
        operator = created.json()["user"]

        permissions = ["tool.lvgl.use", "tool.datasheet.use"]
        saved = client.put(
            f"/api/admin/users/{operator['id']}/permissions",
            json={"permissions": permissions},
        )
        assert saved.status_code == 200
        assert saved.json()["permissions"] == sorted(permissions)

        updated = client.patch(
            f"/api/admin/users/{operator['id']}",
            json={"display_name": "Line Operator", "is_active": False},
        )
        assert updated.status_code == 200
        assert updated.json()["user"]["display_name"] == "Line Operator"
        assert updated.json()["user"]["is_active"] is False

        events = client.get("/api/admin/login-events?limit=10")
        assert events.status_code == 200
        audit = events.json()["events"]
        assert [entry["success"] for entry in audit[:2]] == [True, False]
        assert all("password" not in entry for entry in audit)
        assert events.json()["pagination"] == {
            "page": 1,
            "page_size": 10,
            "total": 2,
            "pages": 1,
        }

        second_page = client.get("/api/admin/login-events?page=2&page_size=1")
        assert second_page.status_code == 200
        assert second_page.json()["pagination"] == {
            "page": 2,
            "page_size": 1,
            "total": 2,
            "pages": 2,
        }
        assert second_page.json()["events"][0]["success"] is False

        self_delete = client.delete(f"/api/admin/users/{admin_user['id']}")
        assert self_delete.status_code == 400
        assert self_delete.json()["detail"] == "cannot delete current user"

"""Standalone FastAPI application for LVGL Designer."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _safe_next_path(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    return value


def _load_env() -> None:
    env_path = PROJECT_ROOT / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def create_app() -> FastAPI:
    _load_env()

    # Windows registry commonly reports .svg as the non-standard image/svg.
    # Chromium refuses to decode that response in an <img>; force the IANA type
    # before StaticFiles asks mimetypes to build its Content-Type header.
    mimetypes.add_type("image/svg+xml", ".svg")

    from .routes import auth, lvgl, lvgl_assets, lvgl_builds, lvgl_catalog, lvgl_icon_library, lvgl_iot, lvgl_projects, lvgl_site_publications
    from .tools.auth import db as auth_db
    from .tools.auth.security import AuthUser, require_login

    app = FastAPI(
        title="LVGL Designer Standalone",
        description="LVGL 9.5 visual designer, project storage, assets, builds, releases and IoT integration.",
        version="1.0.0",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=1)

    app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
    app.include_router(auth.admin_router, prefix="/api/admin", tags=["Admin"])
    app.include_router(lvgl.router, prefix="/api/lvgl", tags=["LVGL AI"])
    app.include_router(lvgl_projects.router, prefix="/api/lvgl/projects", tags=["Projects"])
    app.include_router(lvgl_assets.router, prefix="/api/lvgl/assets", tags=["Assets"])
    app.include_router(lvgl_icon_library.router, prefix="/api/lvgl/icon-library", tags=["Icon Library"])
    app.include_router(lvgl_catalog.router, prefix="/api/lvgl/catalog", tags=["Catalog"])
    app.include_router(lvgl_builds.router, prefix="/api/lvgl/builds", tags=["Builds"])
    app.include_router(lvgl_site_publications.router, prefix="/api/lvgl/site-publications", tags=["Site Publications"])
    app.include_router(lvgl_iot.router, prefix="/api/integrations/iot/v1", tags=["IoT Integration"])

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    designer_dir = Path(os.environ.get("LVD_STATIC_DIR", str(PROJECT_ROOT / "apps" / "designer" / "dist")))
    datasheets_dir = Path(os.environ.get(
        "DATASHEETS_STATIC_DIR",
        str(PROJECT_ROOT / "apps" / "datasheets" / "site"),
    ))
    login_file = PROJECT_ROOT / "backend" / "static" / "login.html"
    portal_file = PROJECT_ROOT / "backend" / "static" / "portal.html"
    account_file = PROJECT_ROOT / "backend" / "static" / "account.html"
    users_file = PROJECT_ROOT / "backend" / "static" / "users.html"
    favicon_file = PROJECT_ROOT / "backend" / "static" / "favicon.svg"
    application_permissions = {
        "/lvgl-designer": "tool.lvgl.use",
        "/datasheets": "tool.datasheet.use",
    }

    def permission_for_path(path: str) -> str | None:
        for prefix, permission in application_permissions.items():
            if path == prefix or path.startswith(prefix + "/"):
                return permission
        return None

    @app.middleware("http")
    async def browser_login_gate(request: Request, call_next):
        path = request.url.path
        accepts_html = "text/html" in request.headers.get("accept", "")
        if request.method == "GET" and path in {"/login", "/login.html"}:
            session_id = request.cookies.get(auth_db.SESSION_COOKIE, "")
            user = auth_db.get_user_by_session(session_id) if session_id else None
            if user is not None:
                return RedirectResponse(_safe_next_path(request.query_params.get("next")), status_code=303)
            return await call_next(request)

        permission = permission_for_path(path)
        platform_permission = "admin.users" if path in {"/admin/users", "/admin/roles"} else None
        protected_page = path in {"/", "/account"} or permission is not None or platform_permission is not None
        if protected_page:
            session_id = request.cookies.get(auth_db.SESSION_COOKIE, "")
            user = auth_db.get_user_by_session(session_id) if session_id else None
            if user is None:
                if request.method == "GET" and accepts_html:
                    destination = path
                    if request.url.query:
                        destination += "?" + request.url.query
                    return RedirectResponse(
                        f"/login?next={quote(destination, safe='')}",
                        status_code=303,
                    )
                return JSONResponse(status_code=401, content={"detail": "请先登录"})
            required_permission = permission or platform_permission
            lacks_permission = (
                required_permission is not None
                and required_permission not in auth_db.get_effective_permissions(user)
            )
            lacks_admin_role = platform_permission is not None and user.get("role") != "admin"
            if lacks_permission or lacks_admin_role:
                if accepts_html:
                    return HTMLResponse(
                        "<!doctype html><meta charset='utf-8'><title>无权访问</title>"
                        "<p>当前账号无权访问该应用。</p><p><a href='/'>返回应用导航</a></p>",
                        status_code=403,
                    )
                return JSONResponse(status_code=403, content={"detail": "权限不足"})
        return await call_next(request)

    @app.get("/", include_in_schema=False)
    async def portal_page():
        return FileResponse(portal_file, media_type="text/html")

    @app.get("/account", include_in_schema=False)
    async def account_page():
        return FileResponse(account_file, media_type="text/html")

    @app.get("/admin/users", include_in_schema=False)
    @app.get("/admin/roles", include_in_schema=False)
    async def users_page():
        return FileResponse(users_file, media_type="text/html")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon():
        return FileResponse(favicon_file, media_type="image/svg+xml")

    @app.get("/api/apps", include_in_schema=False)
    async def application_list(user: AuthUser = Depends(require_login)):
        permissions = set(user.get("permissions", []))
        catalog = [
            {
                "id": "lvgl-designer",
                "name": "LVGL Designer",
                "description": "LVGL 9.5 可视化界面设计、预览与构建",
                "path": "/lvgl-designer/",
                "permission": "tool.lvgl.use",
                "available": designer_dir.is_dir(),
            },
            {
                "id": "datasheets",
                "name": "Datasheets",
                "description": "产品规格书、图纸与 PDF 资料中心",
                "path": "/datasheets/",
                "permission": "tool.datasheet.use",
                "available": datasheets_dir.is_dir(),
            },
        ]
        return {"apps": [item for item in catalog if item["permission"] in permissions]}

    @app.get("/login", include_in_schema=False)
    @app.get("/login.html", include_in_schema=False)
    async def login_page():
        return FileResponse(login_file, media_type="text/html")

    @app.get("/lvgl-designer", include_in_schema=False)
    async def designer_slash_redirect():
        return RedirectResponse("/lvgl-designer/", status_code=307)

    @app.get("/datasheets", include_in_schema=False)
    async def datasheets_slash_redirect():
        return RedirectResponse("/datasheets/", status_code=307)

    if designer_dir.is_dir():
        app.mount(
            "/lvgl-designer",
            StaticFiles(directory=designer_dir, html=True),
            name="designer",
        )
    else:
        @app.get("/lvgl-designer/{requested_path:path}", include_in_schema=False)
        async def missing_designer(requested_path: str):
            return JSONResponse(
                status_code=503,
                content={"error": "designer is not built", "command": "corepack pnpm run build"},
            )

    if datasheets_dir.is_dir():
        app.mount(
            "/datasheets",
            StaticFiles(directory=datasheets_dir, html=True),
            name="datasheets",
        )
    else:
        @app.get("/datasheets/{requested_path:path}", include_in_schema=False)
        async def missing_datasheets(requested_path: str):
            return JSONResponse(
                status_code=503,
                content={"error": "datasheets is not built", "command": "mkdocs build --strict"},
            )

    return app


app = create_app()

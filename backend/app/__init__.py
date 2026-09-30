"""Standalone FastAPI application for LVGL Designer."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles


PROJECT_ROOT = Path(__file__).resolve().parents[2]


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

    from .routes import auth, lvgl, lvgl_assets, lvgl_builds, lvgl_catalog, lvgl_iot, lvgl_projects, lvgl_site_publications
    from .tools.auth import db as auth_db

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
    app.include_router(lvgl_catalog.router, prefix="/api/lvgl/catalog", tags=["Catalog"])
    app.include_router(lvgl_builds.router, prefix="/api/lvgl/builds", tags=["Builds"])
    app.include_router(lvgl_site_publications.router, prefix="/api/lvgl/site-publications", tags=["Site Publications"])
    app.include_router(lvgl_iot.router, prefix="/api/integrations/iot/v1", tags=["IoT Integration"])

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    static_dir = Path(os.environ.get("LVD_STATIC_DIR", str(PROJECT_ROOT / "apps" / "designer" / "dist")))
    login_file = PROJECT_ROOT / "backend" / "static" / "login.html"

    @app.middleware("http")
    async def browser_login_gate(request: Request, call_next):
        path = request.url.path
        accepts_html = "text/html" in request.headers.get("accept", "")
        if request.method == "GET" and accepts_html and not path.startswith(("/api/", "/docs", "/openapi.json")):
            session_id = request.cookies.get(auth_db.SESSION_COOKIE, "")
            user = auth_db.get_user_by_session(session_id) if session_id else None
            if path == "/login.html":
                if user is not None:
                    return RedirectResponse("/", status_code=303)
            elif user is None:
                return RedirectResponse("/login.html", status_code=303)
        return await call_next(request)

    @app.get("/login.html", include_in_schema=False)
    async def login_page():
        return FileResponse(login_file, media_type="text/html")

    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="designer")
    else:
        @app.get("/", include_in_schema=False)
        async def missing_frontend():
            return JSONResponse(
                status_code=503,
                content={"error": "designer is not built", "command": "corepack pnpm run build"},
            )

    return app


app = create_app()

"""Authenticated, read-only Material Symbols catalogue endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..tools.auth.security import AuthUser, require_permission
from ..tools import material_symbols


router = APIRouter()


def _http_error(exc: material_symbols.MaterialSymbolsError) -> HTTPException:
    status = 404 if exc.code == "material-symbols-not-found" else 502
    if exc.code in {"material-symbols-name-invalid", "material-symbols-svg-invalid"}:
        status = 422
    return HTTPException(status_code=status, detail={"code": exc.code, "message": str(exc)})


@router.get("/material-symbols")
async def list_material_symbols(
    query: str = Query("", max_length=80),
    limit: int = Query(80, ge=1, le=200),
    offset: int = Query(0, ge=0, le=10000),
    _user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    try:
        icons, total = await material_symbols.search_icons(query, limit, offset)
    except material_symbols.MaterialSymbolsError as exc:
        raise _http_error(exc) from exc
    return {
        "source": "material-symbols",
        "sourcePage": material_symbols.page_url(),
        "license": "Apache-2.0",
        "icons": icons,
        "total": total,
        "offset": offset,
        "hasMore": offset + len(icons) < total,
    }


@router.get("/material-symbols/{name}.svg")
async def get_material_symbol_svg(
    name: str,
    _user: AuthUser = Depends(require_permission("tool.lvgl.use")),
):
    try:
        svg = await material_symbols.icon_svg(name)
    except material_symbols.MaterialSymbolsError as exc:
        raise _http_error(exc) from exc
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff"},
    )

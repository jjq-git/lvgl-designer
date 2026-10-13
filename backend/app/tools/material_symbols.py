"""Read-only adapter for the intranet Material Symbols catalogue.

The catalogue remains the discovery/source service.  Designer projects store
the selected SVG in their own content-addressed asset store, so builds never
depend on this service being online.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from xml.etree import ElementTree

import httpx


DEFAULT_PAGE_URL = "http://192.168.1.38/pages/tools/material-symbols/"
CATALOG_FILE = "material-symbols-svg.js"
MAX_CATALOG_BYTES = 5 * 1024 * 1024
CACHE_TTL_SECONDS = 10 * 60
ICON_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_]*$")
ENTRY_RE = re.compile(r"^\s*'([a-z0-9][a-z0-9_]*)':\s*'(.*)',?\s*$")
FORBIDDEN_SVG_RE = re.compile(
    r"<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=",
    re.IGNORECASE,
)
ALLOWED_TAGS = {"svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse"}
ALLOWED_ATTRIBUTES = {
    "xmlns", "viewBox", "width", "height", "fill", "fill-rule", "clip-rule", "opacity",
    "d", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "points", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
}

_cache: tuple[float, dict[str, str]] | None = None
_cache_lock = asyncio.Lock()


class MaterialSymbolsError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def page_url() -> str:
    value = os.environ.get("LVGL_MATERIAL_SYMBOLS_URL", DEFAULT_PAGE_URL).strip()
    return value.rstrip("/") + "/"


def _decode_js_string(value: str) -> str:
    """Decode the small escape subset used by the generated SVG module."""

    return (
        value.replace(r"\'", "'")
        .replace(r"\n", "\n")
        .replace(r"\r", "\r")
        .replace(r"\t", "\t")
        .replace(r"\\", "\\")
    )


def parse_catalog_module(source: str) -> dict[str, str]:
    icons: dict[str, str] = {}
    for line in source.splitlines():
        match = ENTRY_RE.match(line)
        if match:
            icons[match.group(1)] = _decode_js_string(match.group(2))
    if not icons:
        raise MaterialSymbolsError("material-symbols-catalog-invalid", "素材库没有可解析的 SVG 图标")
    return icons


def sanitize_svg(svg: str) -> str:
    if len(svg.encode("utf-8")) > 256 * 1024:
        raise MaterialSymbolsError("material-symbols-svg-too-large", "图标 SVG 超过大小限制")
    if FORBIDDEN_SVG_RE.search(svg):
        raise MaterialSymbolsError("material-symbols-svg-unsafe", "图标 SVG 包含不安全内容")
    try:
        root = ElementTree.fromstring(svg)
    except ElementTree.ParseError as exc:
        raise MaterialSymbolsError("material-symbols-svg-invalid", "图标 SVG 无法解析") from exc
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag not in ALLOWED_TAGS:
            raise MaterialSymbolsError("material-symbols-svg-unsafe", f"图标 SVG 包含不允许的元素: {tag}")
        for attribute in element.attrib:
            name = attribute.rsplit("}", 1)[-1]
            if name not in ALLOWED_ATTRIBUTES:
                raise MaterialSymbolsError("material-symbols-svg-unsafe", f"图标 SVG 包含不允许的属性: {name}")
    if root.tag.rsplit("}", 1)[-1] != "svg" or not root.attrib.get("viewBox"):
        raise MaterialSymbolsError("material-symbols-svg-invalid", "图标 SVG 缺少 svg 根元素或 viewBox")
    return svg


async def _download_catalog() -> str:
    url = page_url() + CATALOG_FILE
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(url, headers={"accept": "text/javascript"})
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise MaterialSymbolsError("material-symbols-unavailable", f"无法访问图标素材库: {exc}") from exc
    if len(response.content) > MAX_CATALOG_BYTES:
        raise MaterialSymbolsError("material-symbols-catalog-too-large", "图标素材库响应超过大小限制")
    return response.text


async def catalog(force: bool = False) -> dict[str, str]:
    global _cache
    now = time.monotonic()
    if not force and _cache is not None and now - _cache[0] < CACHE_TTL_SECONDS:
        return _cache[1]
    async with _cache_lock:
        now = time.monotonic()
        if not force and _cache is not None and now - _cache[0] < CACHE_TTL_SECONDS:
            return _cache[1]
        parsed = parse_catalog_module(await _download_catalog())
        _cache = (now, parsed)
        return parsed


async def search_icons(query: str, limit: int, offset: int = 0) -> tuple[list[str], int]:
    icons = await catalog()
    normalized = query.strip().lower().replace(" ", "_")
    names = [name for name in icons if not normalized or normalized in name]
    names.sort(key=lambda name: (
        0 if name == normalized else 1 if name.startswith(normalized) else 2,
        name.find(normalized) if normalized else 0,
        name,
    ))
    return names[offset:offset + limit], len(names)


async def icon_svg(name: str) -> str:
    if not ICON_NAME_RE.fullmatch(name):
        raise MaterialSymbolsError("material-symbols-name-invalid", "图标名称不合法")
    svg = (await catalog()).get(name)
    if svg is None:
        raise MaterialSymbolsError("material-symbols-not-found", f"图标不存在: {name}")
    return sanitize_svg(svg)

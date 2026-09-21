"""LVGL Web Designer integration routes."""

import json
import os

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..tools.auth.security import AuthUser, require_permission

router = APIRouter()

UPSTREAM_TIMEOUT = 120.0
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def _deepseek_url() -> str:
    return DEEPSEEK_BASE_URL.rstrip("/") + "/v1/chat/completions"


def _extract_key(request: Request) -> str:
    header_key = request.headers.get("x-ds-key", "").strip()
    return header_key or (DEEPSEEK_API_KEY or "").strip()


async def _read_json_flag(raw: bytes, key: str) -> bool:
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return False
    return bool(data.get(key))


@router.post("/deepseek/chat")
async def proxy_deepseek_chat(
    request: Request,
    _user: AuthUser = Depends(require_permission("tool.lvgl.ai")),
):
    """Proxy LVGL designer chat-completions requests to DeepSeek.

    The LVGL frontend already sends the OpenAI-compatible chat body. Keep the
    body intact so model, temperature, JSON mode, and stream flags stay owned by
    the designer app.
    """
    key = _extract_key(request)
    if not key:
        return JSONResponse(status_code=401, content={"error": "missing key"})

    raw_body = await request.body()
    content_type = request.headers.get("content-type", "application/json")
    is_stream = await _read_json_flag(raw_body, "stream")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": content_type,
    }
    if is_stream:
        headers["Accept"] = "text/event-stream"

    if is_stream:
        return StreamingResponse(
            _stream_deepseek(raw_body, headers),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )

    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
            upstream = await client.post(_deepseek_url(), headers=headers, content=raw_body)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={"error": "upstream timeout"})
    except Exception:
        return JSONResponse(status_code=502, content={"error": "upstream unreachable"})

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


async def _stream_deepseek(raw_body: bytes, headers: dict[str, str]):
    timeout = httpx.Timeout(UPSTREAM_TIMEOUT, read=UPSTREAM_TIMEOUT)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            async with client.stream("POST", _deepseek_url(), headers=headers, content=raw_body) as upstream:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
        except httpx.TimeoutException:
            yield b'data: {"error":"upstream timeout"}\n\n'
        except Exception:
            yield b'data: {"error":"upstream unreachable"}\n\n'

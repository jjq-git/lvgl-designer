"""Fixed-command bridge for the authoritative podsc-static projection."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_WORKER_PATHS = (
    WORKSPACE_ROOT / "apps" / "build-worker" / "dist" / "lvgl-site-publication-worker.mjs",
    Path("/workspace/lvgl-build-worker/lvgl-site-publication-worker.mjs"),
)
TIMEOUT_SECONDS = int(os.environ.get("LVGL_SITE_PUBLICATION_WORKER_TIMEOUT", "60"))
MAX_OUTPUT_BYTES = 2 * 1024 * 1024


class ProjectionError(RuntimeError):
    def __init__(self, code: str, message: str, diagnostics: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.code = code
        self.diagnostics = diagnostics or []


def _worker_path() -> Path:
    configured = os.environ.get("LVGL_SITE_PUBLICATION_WORKER_PATH")
    candidates = (Path(configured),) if configured else DEFAULT_WORKER_PATHS
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise ProjectionError("publisher-worker-not-installed", "trusted LVGL build worker is not installed")


def project(snapshot: dict[str, Any]) -> dict[str, Any]:
    node = os.environ.get("LVGL_NODE_BINARY") or shutil.which("node")
    if not node:
        raise ProjectionError("node-not-installed", "Node.js runtime is not installed")
    request = json.dumps(
        {"protocolVersion": 1, "command": "project-podsc-static", "snapshot": snapshot},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run(
            [node, str(_worker_path())],
            input=request,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT_SECONDS,
            check=False,
            env={"PATH": os.environ.get("PATH", ""), "NODE_NO_WARNINGS": "1", "LANG": "C.UTF-8"},
            creationflags=creationflags,
        )
    except subprocess.TimeoutExpired as exc:
        raise ProjectionError("publisher-worker-timeout", "podsc-static projection timed out") from exc
    except OSError as exc:
        raise ProjectionError("publisher-worker-start-failed", str(exc)) from exc
    if result.returncode != 0:
        raise ProjectionError("publisher-worker-failed", result.stderr.strip()[:2000] or "worker failed")
    if len(result.stdout.encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ProjectionError("publisher-worker-output-too-large", "projection output exceeded 2 MiB")
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ProjectionError("publisher-worker-protocol-error", "projection worker returned invalid JSON") from exc
    if not isinstance(response, dict) or response.get("command") != "project-podsc-static":
        raise ProjectionError("publisher-worker-protocol-error", "projection response contract mismatch")
    diagnostics = response.get("diagnostics") if isinstance(response.get("diagnostics"), list) else []
    if any(item.get("severity") == "error" for item in diagnostics if isinstance(item, dict)):
        raise ProjectionError("podsc-static-invalid", "project cannot be published to ui.podsc.com", diagnostics)
    if not isinstance(response.get("document"), dict) or not isinstance(response.get("json"), str):
        raise ProjectionError("publisher-worker-protocol-error", "projection did not return a document")
    return response

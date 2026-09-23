"""Read and update the configured ui.podsc.com Git repository through a strict allowlist."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Iterator

from PIL import Image, ImageChops, ImageDraw


WORKSPACE_ROOT = Path(__file__).resolve().parents[4]
TOOL_ROOT = Path(__file__).resolve().parent
DEFAULT_REPOSITORY = "http://192.168.1.88:3000/wf2/ui.podsc.com.git"
DEFAULT_BRANCH = "main"
GIT_TIMEOUT = int(os.environ.get("LVGL_SITE_PUBLICATION_GIT_TIMEOUT", "90"))
COMMAND_TIMEOUT = int(os.environ.get("LVGL_SITE_PUBLICATION_COMMAND_TIMEOUT", "120"))
SEO_BLOCK_RE = re.compile(r"<!-- SEO:HEAD:START -->.*?<!-- SEO:HEAD:END -->", re.DOTALL)
SAFE_FRAME_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$")


class TargetError(RuntimeError):
    def __init__(self, code: str, message: str, detail: Any = None):
        super().__init__(message)
        self.code = code
        self.detail = detail


def configuration() -> tuple[str, str]:
    return (
        os.environ.get("LVGL_PODSC_REPOSITORY", DEFAULT_REPOSITORY),
        os.environ.get("LVGL_PODSC_BRANCH", DEFAULT_BRANCH),
    )


def public_base_url() -> str:
    return os.environ.get("LVGL_PODSC_PUBLIC_URL", "https://ui.podsc.com").rstrip("/")


def _env() -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_CONFIG_NOSYSTEM": "1",
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "LVGL_PODSC_CHROMIUM_PATH"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def _run(args: list[str], cwd: Path, timeout: int = GIT_TIMEOUT) -> str:
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run(
            args, cwd=cwd, env=_env(), capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout, check=False, creationflags=creationflags,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise TargetError("target-command-failed", f"command could not run: {args[0]}") from exc
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip()[:3000]
        raise TargetError("target-command-failed", message or f"command failed: {args[0]}")
    return result.stdout.rstrip()


class Checkout:
    def __init__(self, repository: str, branch: str):
        self.repository = repository
        self.branch = branch
        self._temp: tempfile.TemporaryDirectory[str] | None = None
        self.root: Path | None = None

    def __enter__(self) -> Path:
        self._temp = tempfile.TemporaryDirectory(prefix="lvgl-podsc-")
        self.root = Path(self._temp.name) / "target"
        _run([
            "git", "clone", "--quiet", "--no-tags", "--single-branch", "--branch", self.branch,
            self.repository, str(self.root),
        ], Path(self._temp.name))
        _assert_safe_target(self.root)
        return self.root

    def __exit__(self, *_args: object) -> None:
        if self._temp is not None:
            self._temp.cleanup()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TargetError("target-json-invalid", f"invalid target JSON: {path.name}") from exc
    if not isinstance(value, dict):
        raise TargetError("target-json-invalid", f"target JSON must be an object: {path.name}")
    return value


def _assert_safe_target(root: Path) -> None:
    expected = (
        "site", "site/uis", "site/frames", "site/assets", "scripts",
        "site/ui_list.json", "site/index.html", "site/frames/manifest.json",
        "site/assets/renderer.js", "site/assets/styles.css", "scripts/build_seo.py",
    )
    resolved_root = root.resolve()
    for relative in expected:
        path = root / relative
        if path.is_symlink() or not path.exists():
            raise TargetError("target-layout-invalid", f"目标仓库路径缺失或为符号链接：{relative}")
        try:
            path.resolve().relative_to(resolved_root)
        except ValueError as exc:
            raise TargetError("target-path-traversal", f"目标仓库路径越界：{relative}") from exc


def _manifest(root: Path) -> dict[str, Any]:
    value = _read_json(root / "site" / "frames" / "manifest.json")
    if value.get("schemaVersion") != 1 or not isinstance(value.get("frames"), list):
        raise TargetError("frame-manifest-invalid", "site/frames/manifest.json contract mismatch")
    seen: set[str] = set()
    for frame in value["frames"]:
        frame_id = frame.get("id") if isinstance(frame, dict) else None
        if not isinstance(frame_id, str) or not SAFE_FRAME_ID_RE.fullmatch(frame_id) or frame_id in seen:
            raise TargetError("frame-manifest-invalid", "frame id 缺失、重复或包含不安全字符")
        seen.add(frame_id)
    return value


def _ui_list(root: Path) -> dict[str, Any]:
    value = _read_json(root / "site" / "ui_list.json")
    if value.get("schemaVersion") != 1 or not isinstance(value.get("items"), list):
        raise TargetError("ui-list-invalid", "site/ui_list.json contract mismatch")
    return value


def read_state() -> dict[str, Any]:
    repository, branch = configuration()
    with Checkout(repository, branch) as root:
        commit = _run(["git", "rev-parse", "HEAD"], root)
        manifest = _manifest(root)
        listing = _ui_list(root)
        frames = []
        for raw in manifest["frames"]:
            if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
                continue
            resolution = raw.get("resolution") if isinstance(raw.get("resolution"), dict) else None
            frames.append({
                "id": raw["id"],
                "model": raw.get("model") or raw["id"],
                "nameCn": raw.get("name_cn"),
                "nameEn": raw.get("name_en"),
                "resolution": resolution,
                "shape": raw.get("match", {}).get("shape") if isinstance(raw.get("match"), dict) else None,
            })
        demos = [{
            "id": item.get("id"), "frameId": item.get("frameId"), "name": item.get("name", ""),
            "description": item.get("description", ""), "isPublic": bool(item.get("isPublic", False)),
        } for item in listing["items"] if isinstance(item, dict) and isinstance(item.get("id"), str)]
        return {"targetCommit": commit, "branch": branch, "frames": frames, "demos": demos}


def validate_frame(document: dict[str, Any], frame: dict[str, Any]) -> list[dict[str, str]]:
    diagnostics: list[dict[str, str]] = []
    display = document.get("displayProfile", {})
    logical = display.get("logicalSize", {}) if isinstance(display, dict) else {}
    match = frame.get("match", {}) if isinstance(frame.get("match"), dict) else {}
    expected_shape = match.get("shape")
    if expected_shape and display.get("shape") != expected_shape:
        diagnostics.append({"severity": "error", "code": "E_FRAME_SHAPE_MISMATCH", "path": "displayProfile.shape", "message": f"画布形状与 {frame['id']} 不一致"})
    resolution = frame.get("resolution")
    if isinstance(resolution, dict):
        if logical.get("width") != resolution.get("width") or logical.get("height") != resolution.get("height"):
            diagnostics.append({"severity": "error", "code": "E_FRAME_RESOLUTION_MISMATCH", "path": "displayProfile.logicalSize", "message": f"画布必须为 {resolution.get('width')}×{resolution.get('height')}"})
    else:
        diagnostics.append({"severity": "warning", "code": "W_FRAME_RESOLUTION_UNREGISTERED", "path": "displayProfile.logicalSize", "message": f"{frame['id']} 尚未登记分辨率；本次沿用工程逻辑尺寸"})
    return diagnostics


def _node() -> str:
    binary = os.environ.get("LVGL_NODE_BINARY") or shutil.which("node")
    if not binary:
        raise TargetError("node-not-installed", "Node.js runtime is not installed")
    return binary


def validate_with_target(root: Path, document_path: Path) -> list[dict[str, Any]]:
    output = _run([
        _node(), str(TOOL_ROOT / "target_validate.mjs"),
        str(root / "site" / "assets" / "renderer.js"), str(document_path),
    ], root, COMMAND_TIMEOUT)
    try:
        result = json.loads(output)
    except json.JSONDecodeError as exc:
        raise TargetError("target-validator-failed", "target validator returned invalid JSON") from exc
    if not result.get("valid"):
        raise TargetError("target-validator-rejected", "target renderer rejected the document", result.get("errors", []))
    return []


def render_thumbnail(root: Path, document_path: Path, output_path: Path, document: dict[str, Any]) -> None:
    logical = document["displayProfile"]["logicalSize"]
    _run([
        _node(), str(TOOL_ROOT / "render_thumbnail.mjs"), str(root / "site"), str(document_path),
        str(output_path), str(logical["width"]), str(logical["height"]),
        str(document["displayProfile"].get("shape", "rect")),
    ], WORKSPACE_ROOT, COMMAND_TIMEOUT)
    if not output_path.is_file() or output_path.stat().st_size < 100:
        raise TargetError("thumbnail-failed", "target renderer did not produce a valid PNG")
    if document["displayProfile"].get("shape") == "round":
        with Image.open(output_path) as source:
            image = source.convert("RGBA")
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, image.width - 1, image.height - 1), fill=255)
        image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
        image.save(output_path, format="PNG")
    _assert_thumbnail_content(output_path, document)


def _walk_nodes(node: Any) -> Iterator[dict[str, Any]]:
    if not isinstance(node, dict):
        return
    yield node
    for child in node.get("children", []):
        yield from _walk_nodes(child)


def _assert_thumbnail_content(output_path: Path, document: dict[str, Any]) -> None:
    project = document.get("uiProject") if isinstance(document.get("uiProject"), dict) else {}
    screens = project.get("screens") if isinstance(project.get("screens"), list) else []
    home = next((screen for screen in screens if isinstance(screen, dict) and screen.get("isHome")), None)
    if home is None:
        home = next((screen for screen in screens if isinstance(screen, dict)), None)
    root = home.get("root") if isinstance(home, dict) else None
    widgets = list(_walk_nodes(root))
    if len(widgets) <= 1:
        raise TargetError("thumbnail-blank", "首页没有可见组件，禁止发布空白或 mock 缩略图", "uiProject.screens[].root.children")

    with Image.open(output_path) as source:
        rgba = source.convert("RGBA")
    opaque = [pixel[:3] for pixel in rgba.getdata() if pixel[3] >= 250]
    if not opaque:
        raise TargetError("thumbnail-blank", "缩略图没有可见像素，禁止发布空白截图", "thumbnail.png")
    counts: dict[tuple[int, int, int], int] = {}
    for color in opaque:
        counts[color] = counts.get(color, 0) + 1
    dominant_share = max(counts.values()) / len(opaque)
    if dominant_share >= 0.995:
        raise TargetError(
            "thumbnail-blank", "缩略图几乎为单一颜色，疑似空白或 mock 截图，禁止发布",
            {"path": "thumbnail.png", "dominantShare": round(dominant_share, 6)},
        )


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _find_frame(root: Path, frame_id: str) -> dict[str, Any]:
    matches = [frame for frame in _manifest(root)["frames"] if isinstance(frame, dict) and frame.get("id") == frame_id]
    if len(matches) != 1:
        raise TargetError("frame-not-found", f"目标提交不存在 frameId：{frame_id}")
    return matches[0]


def _find_item(listing: dict[str, Any], demo_id: str) -> tuple[int, dict[str, Any]] | None:
    for index, item in enumerate(listing["items"]):
        if isinstance(item, dict) and item.get("id") == demo_id:
            return index, item
    return None


def _merge_item(
    listing: dict[str, Any], record: dict[str, Any], document_url: str, thumbnail_url: str,
    expected_previous: dict[str, Any] | None,
) -> None:
    found = _find_item(listing, record["demoId"])
    if expected_previous is None and found is not None:
        raise TargetError("demo-conflict", "新 Demo UUID 已存在")
    if expected_previous is not None:
        if found is None or found[1] != expected_previous:
            raise TargetError("demo-conflict", "同一 Demo 已被其他提交修改")
    replacement = {
        **({} if found is None else found[1]),
        "id": record["demoId"], "frameId": record["frameId"], "name": record["name"],
        "description": record["description"], "documentUrl": document_url,
        "thumbnailUrl": thumbnail_url, "isPublic": record["isPublic"],
    }
    if found is None:
        listing["items"].append(replacement)
    else:
        listing["items"][found[0]] = replacement


def _git_paths(root: Path) -> set[str]:
    output = _run(["git", "status", "--porcelain=v1", "--untracked-files=all"], root)
    paths: set[str] = set()
    for line in output.splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.add(path.replace("\\", "/"))
    return paths


def _run_seo(root: Path) -> None:
    python = os.environ.get("LVGL_PYTHON_BINARY") or shutil.which("python3") or shutil.which("python")
    if not python:
        raise TargetError("python-not-installed", "Python 3.9+ is required for target SEO generation")
    wrapper = str(TOOL_ROOT / "run_target_python.py")
    _run([python, wrapper, "scripts/build_seo.py"], root, COMMAND_TIMEOUT)
    _run([python, wrapper, "scripts/build_seo.py", "--check"], root, COMMAND_TIMEOUT)
    _run([python, "-B", wrapper, "--module", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], root, COMMAND_TIMEOUT)


def _assert_allowlist(root: Path, record: dict[str, Any], document_url: str, thumbnail_url: str, index_before: str) -> list[str]:
    allowed = {
        "site/ui_list.json", document_url, thumbnail_url, "site/index.html", "site/sitemap.xml",
        "site/robots.txt", f"site/demos/{record['demoId']}.html",
    }
    changed = _git_paths(root)
    rejected = sorted(changed - allowed)
    if rejected:
        raise TargetError("write-allowlist-violation", "目标脚本修改了禁止路径", rejected)
    index_path = root / "site" / "index.html"
    if index_path.read_text(encoding="utf-8") != index_before:
        before = SEO_BLOCK_RE.sub("<SEO-BLOCK>", index_before)
        after = SEO_BLOCK_RE.sub("<SEO-BLOCK>", index_path.read_text(encoding="utf-8"))
        if before != after:
            raise TargetError("write-allowlist-violation", "SEO 脚本修改了 index.html 的手写区块")
    frames_changed = [path for path in changed if path.startswith("site/frames/")]
    if frames_changed:
        raise TargetError("frames-read-only", "发布器不得修改 frames", frames_changed)
    return sorted(changed)


def prepare(record: dict[str, Any], document_json: str, artifact_dir: Path) -> dict[str, Any]:
    repository, branch = configuration()
    with Checkout(repository, branch) as root:
        base_commit = _run(["git", "rev-parse", "HEAD"], root)
        document = json.loads(document_json)
        frame = _find_frame(root, record["frameId"])
        diagnostics = validate_frame(document, frame)
        errors = [item for item in diagnostics if item["severity"] == "error"]
        if errors:
            raise TargetError("frame-incompatible", "frame 与 UI 不兼容", errors)
        listing = _ui_list(root)
        found = _find_item(listing, record["demoId"])
        if record.get("boundExisting") and found is None:
            raise TargetError("demo-not-found", "要更新的 Demo UUID 不存在")
        if not record.get("boundExisting") and found is not None:
            raise TargetError("demo-conflict", "新 Demo UUID 已存在")
        expected_previous = None if found is None else found[1]
        artifact_dir.mkdir(parents=True, exist_ok=False)
        document_path = artifact_dir / "document.json"
        document_path.write_text(document_json, encoding="utf-8", newline="\n")
        validate_with_target(root, document_path)
        thumbnail_path = artifact_dir / "thumbnail.png"
        render_thumbnail(root, document_path, thumbnail_path, document)
        renderer_path = root / "site" / "assets" / "renderer.js"
        styles_path = root / "site" / "assets" / "styles.css"
        shutil.copyfile(renderer_path, artifact_dir / "renderer.js")
        shutil.copyfile(styles_path, artifact_dir / "styles.css")
        thumbnail_sha = hashlib.sha256(thumbnail_path.read_bytes()).hexdigest()
        document_sha = hashlib.sha256(document_json.encode("utf-8")).hexdigest()
        document_url = f"site/uis/{record['frameId']}-{record['demoId']}.{document_sha[:16]}.json"
        thumbnail_url = f"site/uis/{record['frameId']}-{record['demoId']}.{thumbnail_sha[:16]}.png"
        target_document = root / document_url
        target_thumbnail = root / thumbnail_url
        target_document.parent.mkdir(parents=True, exist_ok=True)
        target_document.write_text(document_json, encoding="utf-8", newline="\n")
        shutil.copyfile(thumbnail_path, target_thumbnail)
        _merge_item(listing, record, document_url.removeprefix("site/"), thumbnail_url.removeprefix("site/"), expected_previous)
        merged = _find_item(listing, record["demoId"])
        next_item = None if merged is None else merged[1]
        _write_json(root / "site" / "ui_list.json", listing)
        index_before = (root / "site" / "index.html").read_text(encoding="utf-8")
        _run_seo(root)
        changed = _assert_allowlist(root, record, document_url, thumbnail_url, index_before)
        diff = _run(["git", "diff", "--stat", "--", *changed], root) if changed else ""
        plan = {
            "schemaVersion": 1, "targetBaseCommit": base_commit, "expectedPrevious": expected_previous,
            "documentUrl": document_url, "thumbnailUrl": thumbnail_url,
            "documentSha256": document_sha, "thumbnailSha256": thumbnail_sha,
            "consumerRendererSha256": hashlib.sha256(renderer_path.read_bytes()).hexdigest(),
            "consumerStylesSha256": hashlib.sha256(styles_path.read_bytes()).hexdigest(),
            "changedPaths": changed, "diagnostics": diagnostics, "diffStat": diff,
            "manifestChange": {"before": expected_previous, "after": next_item},
        }
        _write_json(artifact_dir / "plan.json", plan)
        return plan


def _changed_since(root: Path, base_commit: str) -> set[str]:
    try:
        output = _run(["git", "diff", "--name-only", f"{base_commit}..HEAD"], root)
    except TargetError as exc:
        raise TargetError("prepared-target-expired", "准备时的目标提交已不在分支历史中") from exc
    return {line.strip().replace("\\", "/") for line in output.splitlines() if line.strip()}


def publish(record: dict[str, Any], artifact_dir: Path, _attempt: int = 0) -> dict[str, Any]:
    repository, branch = configuration()
    plan = _read_json(artifact_dir / "plan.json")
    document_json = (artifact_dir / "document.json").read_text(encoding="utf-8")
    if hashlib.sha256(document_json.encode("utf-8")).hexdigest() != plan.get("documentSha256"):
        raise TargetError("prepared-artifact-corrupt", "prepared document hash mismatch")
    thumbnail = (artifact_dir / "thumbnail.png").read_bytes()
    if hashlib.sha256(thumbnail).hexdigest() != plan.get("thumbnailSha256"):
        raise TargetError("prepared-artifact-corrupt", "prepared thumbnail hash mismatch")
    with Checkout(repository, branch) as root:
        head = _run(["git", "rev-parse", "HEAD"], root)
        if head != plan["targetBaseCommit"]:
            sensitive = {
                "site/assets/renderer.js", "site/assets/styles.css", "scripts/build_seo.py",
                "site/frames/manifest.json",
            }
            changed_since = _changed_since(root, plan["targetBaseCommit"])
            if changed_since & sensitive or any(path.startswith("site/frames/") for path in changed_since):
                raise TargetError("prepared-target-expired", "目标 Renderer、SEO 或 frame 在准备后发生变化，请重新准备")
        listing = _ui_list(root)
        current = _find_item(listing, record["demoId"])
        desired_fields = {
            "id": record["demoId"], "frameId": record["frameId"], "name": record["name"],
            "description": record["description"],
            "documentUrl": plan["documentUrl"].removeprefix("site/"),
            "thumbnailUrl": plan["thumbnailUrl"].removeprefix("site/"), "isPublic": record["isPublic"],
        }
        already_written = current is not None and all(current[1].get(key) == value for key, value in desired_fields.items())
        if already_written:
            current_document = root / plan["documentUrl"]
            current_thumbnail = root / plan["thumbnailUrl"]
            if (current_document.is_file() and current_thumbnail.is_file()
                    and hashlib.sha256(current_document.read_bytes()).hexdigest() == plan["documentSha256"]
                    and hashlib.sha256(current_thumbnail.read_bytes()).hexdigest() == plan["thumbnailSha256"]):
                existing = _run(["git", "log", "-1", "--format=%H", "--", plan["documentUrl"]], root)
                return {"commitSha": existing or head, "changedPaths": [], "idempotent": True}
        _merge_item(
            listing, record, plan["documentUrl"].removeprefix("site/"),
            plan["thumbnailUrl"].removeprefix("site/"), plan.get("expectedPrevious"),
        )
        document_path = root / plan["documentUrl"]
        thumbnail_path = root / plan["thumbnailUrl"]
        document_path.parent.mkdir(parents=True, exist_ok=True)
        document_path.write_text(document_json, encoding="utf-8", newline="\n")
        thumbnail_path.write_bytes(thumbnail)
        validate_with_target(root, document_path)
        _write_json(root / "site" / "ui_list.json", listing)
        index_before = (root / "site" / "index.html").read_text(encoding="utf-8")
        _run_seo(root)
        changed = _assert_allowlist(root, record, plan["documentUrl"], plan["thumbnailUrl"], index_before)
        if not changed:
            existing = _run(["git", "log", "-1", "--format=%H", "--", plan["documentUrl"]], root)
            return {"commitSha": existing or head, "changedPaths": [], "idempotent": True}
        _run(["git", "add", "--", *changed], root)
        _run(["git", "-c", "user.name=LVGL Designer Publisher", "-c", "user.email=lvgl-publisher@dengtec.local",
              "commit", "-m", f"publish(ui): {record['name']} ({record['demoId']})"], root)
        commit = _run(["git", "rev-parse", "HEAD"], root)
        try:
            _run(["git", "push", "origin", f"HEAD:{branch}"], root)
        except TargetError as exc:
            message = str(exc).lower()
            concurrent = any(token in message for token in ("non-fast-forward", "fetch first", "rejected"))
            if concurrent and _attempt < 2:
                return publish(record, artifact_dir, _attempt + 1)
            raise
        return {"commitSha": commit, "changedPaths": changed, "idempotent": False}


def rollback(record: dict[str, Any], artifact_dir: Path, _attempt: int = 0) -> dict[str, Any]:
    """Create a compensating commit touching only this publication's files."""

    _repository, branch = configuration()
    plan = _read_json(artifact_dir / "plan.json")
    with Checkout(*configuration()) as root:
        listing = _ui_list(root)
        found = _find_item(listing, record["demoId"])
        expected_previous = plan.get("expectedPrevious")
        if found is None and expected_previous is None:
            commit = _run(["git", "log", "-1", "--format=%H", "--", "site/ui_list.json"], root)
            return {"commitSha": commit, "changedPaths": [], "idempotent": True}
        if found is None:
            raise TargetError("demo-conflict", "Demo 已被其他提交删除，不能自动回滚")
        published_urls = {
            "documentUrl": plan["documentUrl"].removeprefix("site/"),
            "thumbnailUrl": plan["thumbnailUrl"].removeprefix("site/"),
        }
        if any(found[1].get(key) != value for key, value in published_urls.items()):
            if expected_previous is not None and found[1] == expected_previous:
                commit = _run(["git", "log", "-1", "--format=%H", "--", "site/ui_list.json"], root)
                return {"commitSha": commit, "changedPaths": [], "idempotent": True}
            raise TargetError("demo-conflict", "Demo 在发布后已被其他提交修改，不能自动回滚")
        if expected_previous is None:
            del listing["items"][found[0]]
        else:
            listing["items"][found[0]] = expected_previous
        referenced = {
            item.get(key)
            for item in listing["items"] if isinstance(item, dict)
            for key in ("documentUrl", "thumbnailUrl")
        }
        for relative in (plan["documentUrl"], plan["thumbnailUrl"]):
            if relative.removeprefix("site/") not in referenced:
                path = root / relative
                if path.is_file():
                    path.unlink()
        _write_json(root / "site" / "ui_list.json", listing)
        index_before = (root / "site" / "index.html").read_text(encoding="utf-8")
        _run_seo(root)
        changed = _assert_allowlist(root, record, plan["documentUrl"], plan["thumbnailUrl"], index_before)
        if not changed:
            commit = _run(["git", "rev-parse", "HEAD"], root)
            return {"commitSha": commit, "changedPaths": [], "idempotent": True}
        _run(["git", "add", "--all", "--", *changed], root)
        _run(["git", "-c", "user.name=LVGL Designer Publisher", "-c", "user.email=lvgl-publisher@dengtec.local",
              "commit", "-m", f"rollback(ui): {record['name']} ({record['demoId']})"], root)
        commit = _run(["git", "rev-parse", "HEAD"], root)
        try:
            _run(["git", "push", "origin", f"HEAD:{branch}"], root)
        except TargetError as exc:
            message = str(exc).lower()
            concurrent = any(token in message for token in ("non-fast-forward", "fetch first", "rejected"))
            if concurrent and _attempt < 2:
                return rollback(record, artifact_dir, _attempt + 1)
            raise
        return {"commitSha": commit, "changedPaths": changed, "idempotent": False}

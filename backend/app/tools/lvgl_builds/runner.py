"""Fixed-command bridge from queued builds to the bundled Node C95 worker."""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import uuid
import hashlib
from pathlib import Path
from typing import Any

from ..lvgl_assets import converter as asset_converter
from ..lvgl_assets import store as asset_store
from . import compile_gate, db


WORKSPACE_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_WORKER_PATHS = (
    WORKSPACE_ROOT / "apps" / "build-worker" / "dist" / "lvgl-build-worker.mjs",
    Path("/workspace/lvgl-build-worker/lvgl-build-worker.mjs"),
)
DEFAULT_PREVIEW_HOST_PATHS = (
    WORKSPACE_ROOT / "apps" / "preview-host" / "dist",
    Path("/workspace/lvgl-preview-host"),
)
DEFAULT_RUNTIME_MANIFEST_PATHS = (
    WORKSPACE_ROOT / "packages" / "lvgl-runtime" / "dist" / "build-manifest.json",
    Path("/workspace/lvgl-preview-host/runtime-build-manifest.json"),
)
WORKER_TIMEOUT_SECONDS = int(os.environ.get("LVGL_BUILD_TIMEOUT_SECONDS", "60"))
MAX_WORKER_OUTPUT_BYTES = int(os.environ.get("LVGL_BUILD_WORKER_MAX_OUTPUT", str(50 * 1024 * 1024)))
LEASE_TTL_SECONDS = int(os.environ.get("LVGL_BUILD_LEASE_SECONDS", str(WORKER_TIMEOUT_SECONDS + 120)))


class WorkerExecutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _first_existing(candidates: tuple[Path, ...], kind: str, directory: bool = False) -> Path:
    for candidate in candidates:
        if candidate.is_dir() if directory else candidate.is_file():
            return candidate.resolve()
    raise WorkerExecutionError(f"{kind}-not-installed", f"trusted {kind.replace('-', ' ')} is not installed")


def _sealed_preview_files(owner_user_id: int, input_lock: dict[str, Any]) -> tuple[dict[str, bytes], dict[str, Any]]:
    host_root = _first_existing(DEFAULT_PREVIEW_HOST_PATHS, "preview-host", directory=True)
    manifest_path = _first_existing(DEFAULT_RUNTIME_MANIFEST_PATHS, "preview-runtime-manifest")
    try:
        runtime_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkerExecutionError("preview-runtime-invalid", "preview runtime manifest is invalid") from exc
    generator = input_lock.get("generator", {})
    if (
        runtime_manifest.get("lvglVersion") != generator.get("lvglVersion")
        or runtime_manifest.get("lvglCommit") != generator.get("lvglCommit")
        or runtime_manifest.get("runtimeMode") != "preview-program"
    ):
        raise WorkerExecutionError(
            "preview-runtime-mismatch",
            "preview runtime version/commit does not match the immutable build input",
        )

    files: dict[str, bytes] = {}
    allowed_suffixes = {".html", ".js", ".css", ".wasm"}
    for source in sorted(host_root.rglob("*")):
        if not source.is_file() or source.is_symlink() or source.suffix.lower() not in allowed_suffixes:
            continue
        relative = source.relative_to(host_root).as_posix()
        files[f"preview/{relative}"] = source.read_bytes()
    required = {"preview/index.html", "preview/preview-host.js", "preview/lvgl_runtime.wasm"}
    if not required.issubset(files):
        raise WorkerExecutionError("preview-host-invalid", "preview host is missing required sealed files")
    runtime_manifest_bytes = json.dumps(
        runtime_manifest, ensure_ascii=False, sort_keys=True, indent=2,
    ).encode("utf-8") + b"\n"
    files["preview/runtime-build-manifest.json"] = runtime_manifest_bytes

    for asset in input_lock.get("assets", []):
        if not isinstance(asset, dict) or asset.get("category") not in {"fonts", "images"}:
            continue
        sha256 = str(asset.get("sha256", ""))
        _metadata, payload = asset_store.read_verified(owner_user_id, sha256, asset.get("byteSize"))
        path = f"preview/assets/{sha256}"
        prior = files.get(path)
        if prior is not None and prior != payload:
            raise WorkerExecutionError("preview-asset-collision", f"preview asset hash collision: {sha256}")
        files[path] = payload

    attestation = {
        "status": "sealed",
        "entrypoint": "preview/index.html",
        "program": "preview/preview-program.json",
        "runtime": {
            "lvglVersion": runtime_manifest["lvglVersion"],
            "lvglCommit": runtime_manifest["lvglCommit"],
            "lvConfSha256": runtime_manifest.get("lvConfSha256"),
            "toolchain": runtime_manifest.get("toolchain"),
        },
        "hostFilesSha256": hashlib.sha256(b"".join(
            path.encode("utf-8") + b"\0" + hashlib.sha256(content).digest()
            for path, content in sorted(files.items())
        )).hexdigest(),
    }
    return files, attestation


def _worker_path() -> Path:
    configured = os.environ.get("LVGL_BUILD_WORKER_PATH")
    candidates = (Path(configured),) if configured else DEFAULT_WORKER_PATHS
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise WorkerExecutionError("worker-not-installed", "trusted LVGL build worker is not installed")


def _node_binary() -> str:
    configured = os.environ.get("LVGL_NODE_BINARY")
    binary = configured or shutil.which("node")
    if not binary:
        raise WorkerExecutionError("node-not-installed", "Node.js runtime is not installed")
    return binary


def _resolved_executable(command: str) -> Path:
    candidate = Path(command)
    resolved = candidate.resolve() if candidate.is_file() else None
    if resolved is None:
        found = shutil.which(command)
        resolved = Path(found).resolve() if found else None
    if resolved is None or not resolved.is_file():
        raise WorkerExecutionError("worker-runtime-unattested", f"cannot resolve runtime executable: {command}")
    return resolved


def _worker_attestation(node: str, worker: Path, env: dict[str, str]) -> dict[str, Any]:
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        version = subprocess.run(
            [node, "--version"], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=10, check=False, env=env, creationflags=creationflags,
        )
    except OSError as exc:
        raise WorkerExecutionError("worker-runtime-unattested", f"cannot attest runtime: {exc}") from exc
    if version.returncode != 0:
        raise WorkerExecutionError("worker-runtime-unattested", "runtime version command failed")
    node_path = _resolved_executable(node)
    try:
        runtime_sha256 = hashlib.sha256(node_path.read_bytes()).hexdigest()
        worker_sha256 = hashlib.sha256(worker.read_bytes()).hexdigest()
    except OSError as exc:
        raise WorkerExecutionError("worker-runtime-unattested", f"cannot hash trusted worker runtime: {exc}") from exc
    attestation: dict[str, Any] = {
        "runtimeVersion": (version.stdout or version.stderr).strip().splitlines()[0],
        "runtimePath": str(node_path),
        "runtimeSha256": runtime_sha256,
        "workerPath": str(worker),
        "workerSha256": worker_sha256,
    }
    provenance_path = worker.with_name("build-provenance.json")
    if provenance_path.is_file():
        try:
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise WorkerExecutionError("worker-runtime-unattested", "worker build provenance is invalid") from exc
        claimed = provenance.get("worker", {}).get("sha256") if isinstance(provenance, dict) else None
        if claimed != worker_sha256:
            raise WorkerExecutionError("worker-runtime-unattested", "worker hash does not match build provenance")
        attestation["buildProvenance"] = provenance
        attestation["buildProvenanceSha256"] = hashlib.sha256(provenance_path.read_bytes()).hexdigest()
    return attestation


def _font_payloads(owner_user_id: int, input_lock: dict[str, Any]) -> dict[str, str]:
    payloads: dict[str, str] = {}
    for asset in input_lock.get("assets", []):
        if not isinstance(asset, dict) or asset.get("category") != "fonts":
            continue
        sha256 = str(asset.get("sha256", ""))
        _metadata, payload = asset_store.read_verified(owner_user_id, sha256, asset.get("byteSize"))
        payloads[sha256] = base64.b64encode(payload).decode("ascii")
    return payloads


def _invoke(input_lock: dict[str, Any], asset_payloads: dict[str, str] | None = None) -> dict[str, Any]:
    node = _node_binary()
    worker = _worker_path()
    request = json.dumps(
        {
            "protocolVersion": 1,
            "inputLock": input_lock,
            "target": "esp-idf",
            "assetPayloads": asset_payloads or {},
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    task_root = db.DATA_DIR / "build_tmp"
    task_root.mkdir(parents=True, exist_ok=True)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "NODE_NO_WARNINGS": "1",
        "LANG": "C.UTF-8",
    }
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    attestation = _worker_attestation(node, worker, env)
    try:
        with tempfile.TemporaryDirectory(prefix="lvgl-build-", dir=task_root) as temp_dir:
            result = subprocess.run(
                [node, str(worker)],
                input=request,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                cwd=temp_dir,
                env=env,
                timeout=WORKER_TIMEOUT_SECONDS,
                check=False,
                creationflags=creationflags,
            )
    except subprocess.TimeoutExpired as exc:
        raise WorkerExecutionError("worker-timeout", "trusted LVGL build worker timed out") from exc
    except OSError as exc:
        raise WorkerExecutionError("worker-start-failed", f"could not start trusted worker: {exc}") from exc
    if len(result.stdout.encode("utf-8")) > MAX_WORKER_OUTPUT_BYTES:
        raise WorkerExecutionError("worker-output-too-large", "worker output exceeded configured limit")
    if result.returncode != 0:
        message = result.stderr.strip()[:2000] or f"worker exited with code {result.returncode}"
        raise WorkerExecutionError("worker-failed", message)
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise WorkerExecutionError("worker-protocol-error", "worker returned invalid JSON") from exc
    if (
        not isinstance(response, dict)
        or response.get("protocolVersion") != 1
        or not isinstance(response.get("files"), dict)
        or not isinstance(response.get("diagnostics"), list)
        or not isinstance(response.get("generatorManifest"), dict)
    ):
        raise WorkerExecutionError("worker-protocol-error", "worker response does not match protocol v1")
    response["generatorManifest"]["workerRuntime"] = attestation
    return response


def run_build(
    owner_user_id: int,
    build_id: str,
    lease_token: str | None = None,
) -> dict[str, Any] | None:
    """Run one queued build. All failures are recorded; none escape background execution."""

    build = db.get_build(owner_user_id, build_id, include_input=True)
    if build is None:
        return None
    token = lease_token or f"{os.getpid()}-{uuid.uuid4().hex}"
    if not db.acquire_build_lease(build_id, token, LEASE_TTL_SECONDS):
        return db.get_build(owner_user_id, build_id)
    try:
        db.transition_build(owner_user_id, build_id, "validating", None)
        try:
            asset_store.verify_asset_locks(owner_user_id, build["inputLock"].get("assets", []))
        except asset_store.AssetStoreError as exc:
            return db.fail_build(owner_user_id, build_id, exc.code, str(exc))
        db.transition_build(owner_user_id, build_id, "building", None)
        response = _invoke(build["inputLock"], _font_payloads(owner_user_id, build["inputLock"]))
        diagnostics = response["diagnostics"]
        errors = [item for item in diagnostics if isinstance(item, dict) and item.get("severity") == "error"]
        if errors:
            return db.fail_build(
                owner_user_id, build_id, "generator-diagnostics",
                f"generator returned {len(errors)} blocking diagnostic(s)", diagnostics,
            )
        asset_files, asset_manifest = asset_converter.convert_locked_assets(
            owner_user_id, build["inputLock"].get("assets", []),
        )
        collisions = set(response["files"]).intersection(asset_files)
        if collisions:
            raise WorkerExecutionError("asset-output-collision", f"asset output collides with generator: {sorted(collisions)[0]}")
        response["files"].update(asset_files)
        prior_assets = response["generatorManifest"].get("convertedAssets", [])
        response["generatorManifest"]["convertedAssets"] = [
            *(prior_assets if isinstance(prior_assets, list) else []),
            *asset_manifest,
        ]
        if "preview/preview-program.json" in response["files"]:
            preview_files, preview_attestation = _sealed_preview_files(owner_user_id, build["inputLock"])
            preview_collisions = set(response["files"]).intersection(preview_files)
            if preview_collisions:
                raise WorkerExecutionError(
                    "preview-output-collision",
                    f"preview host output collides with generator: {sorted(preview_collisions)[0]}",
                )
            response["files"].update(preview_files)
            response["generatorManifest"]["sealedPreview"] = preview_attestation
        try:
            compile_validation = compile_gate.validate_generated_sources(
                response["files"], build["inputLock"], db.DATA_DIR / "build_tmp",
            )
        except compile_gate.CompileGateError as exc:
            diagnostics.append({"severity": "error", "code": exc.code, "message": str(exc)})
            return db.fail_build(owner_user_id, build_id, exc.code, str(exc), diagnostics)
        response["generatorManifest"]["compileValidation"] = compile_validation
        if compile_validation.get("status") != "passed":
            diagnostics.append({
                "severity": "warning",
                "code": "W_COMPILE_GATE_NOT_RUN",
                "message": "generated C sources were not compiled; this build cannot be approved for publication",
            })
        return db.complete_build(
            owner_user_id, build_id, response["files"], diagnostics, response["generatorManifest"],
        )
    except db.BuildStateError:
        return db.get_build(owner_user_id, build_id)
    except (WorkerExecutionError, asset_store.AssetStoreError, db.ArtifactValidationError) as exc:
        code = exc.code if isinstance(exc, (WorkerExecutionError, asset_store.AssetStoreError)) else "artifact-validation"
        try:
            return db.fail_build(owner_user_id, build_id, code, str(exc))
        except db.BuildStateError:
            return db.get_build(owner_user_id, build_id)
    finally:
        db.release_build_lease(build_id, token)

"""Fixed-command compilation gate for generated LVGL sources.

The gate never accepts commands from a project document. Production enables the
host gate with ``LVGL_BUILD_COMPILE_GATE=host`` and supplies an attested LVGL
9.5 source tree. ``esp-idf`` additionally builds a minimal target firmware and
is the only release-qualified policy. Development may leave the gate disabled,
but such builds are marked ``not-run`` and cannot be approved for publication.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Mapping


COMPILE_TIMEOUT_SECONDS = int(os.environ.get("LVGL_COMPILE_TIMEOUT_SECONDS", "180"))
MAX_LOG_CHARS = int(os.environ.get("LVGL_COMPILE_MAX_LOG_CHARS", "12000"))
EXPECTED_LVGL_VERSION = "9.5.0"
ESP_IDF_TARGETS = frozenset({
    "esp32", "esp32s2", "esp32s3", "esp32c2", "esp32c3",
    "esp32c5", "esp32c6", "esp32h2", "esp32p4",
})


class CompileGateError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _policy() -> str:
    policy = os.environ.get("LVGL_BUILD_COMPILE_GATE", "none").strip().lower()
    if policy not in {"none", "host", "esp-idf"}:
        raise CompileGateError("compile-gate-policy-invalid", f"unsupported compile gate policy: {policy}")
    return policy


def _safe_relative(path: str) -> PurePosixPath:
    if not path or "\\" in path or "\x00" in path:
        raise CompileGateError("compile-input-invalid", "generated file has an unsafe path")
    pure = PurePosixPath(path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise CompileGateError("compile-input-invalid", f"generated file has an unsafe path: {path!r}")
    return pure


def _materialize(root: Path, files: Mapping[str, str | bytes]) -> int:
    source_count = 0
    for name, content in files.items():
        pure = _safe_relative(name)
        destination = root.joinpath(*pure.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        data = content.encode("utf-8") if isinstance(content, str) else bytes(content)
        destination.write_bytes(data)
        if destination.suffix.lower() == ".c":
            source_count += 1
    if source_count == 0:
        raise CompileGateError("compile-input-empty", "generated artifact contains no C sources")
    return source_count


def _lvgl_version(source: Path) -> str:
    header = source / "lv_version.h"
    if not (source / "lvgl.h").is_file() or not header.is_file():
        raise CompileGateError("lvgl-source-missing", f"LVGL source tree is incomplete: {source}")
    text = header.read_text(encoding="utf-8", errors="replace")
    values = []
    for name in ("MAJOR", "MINOR", "PATCH"):
        match = re.search(rf"^\s*#define\s+LVGL_VERSION_{name}\s+(\d+)\s*$", text, re.MULTILINE)
        if match is None:
            raise CompileGateError("lvgl-source-version-invalid", f"cannot read LVGL {name.lower()} version")
        values.append(match.group(1))
    return ".".join(values)


def _source_attestation(source: Path, expected_commit: str) -> dict[str, str]:
    actual_version = _lvgl_version(source)
    if actual_version != EXPECTED_LVGL_VERSION:
        raise CompileGateError(
            "lvgl-source-version-mismatch",
            f"compile gate requires LVGL {EXPECTED_LVGL_VERSION}, source tree is {actual_version}",
        )
    stamp = source / ".lvd-source-commit"
    if not stamp.is_file():
        raise CompileGateError("lvgl-source-unattested", "LVGL source tree has no .lvd-source-commit attestation")
    actual_commit = stamp.read_text(encoding="ascii", errors="strict").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", actual_commit):
        raise CompileGateError("lvgl-source-unattested", "LVGL source commit attestation is invalid")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit.lower()) or actual_commit != expected_commit.lower():
        raise CompileGateError(
            "lvgl-source-commit-mismatch",
            f"LVGL source commit {actual_commit} does not match locked commit {expected_commit}",
        )
    return {
        "lvglVersion": actual_version,
        "lvglCommit": actual_commit,
        "lvVersionHeaderSha256": hashlib.sha256((source / "lv_version.h").read_bytes()).hexdigest(),
    }


def _idf_attestation(
    idf_path: Path, input_lock: Mapping[str, Any], version_line: str,
) -> dict[str, str]:
    generator = input_lock.get("generator", {})
    expected_version = str(generator.get("espIdfVersion", "")) if isinstance(generator, Mapping) else ""
    expected_commit = str(generator.get("espIdfCommit", "")).lower() if isinstance(generator, Mapping) else ""
    version_match = re.search(r"(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)", version_line)
    actual_version = version_match.group(1) if version_match else ""
    if not expected_version or actual_version != expected_version:
        raise CompileGateError(
            "esp-idf-version-mismatch",
            f"ESP-IDF version {actual_version or 'unknown'} does not match locked version {expected_version or 'missing'}",
        )
    stamp = idf_path / ".lvd-source-commit"
    if not stamp.is_file():
        raise CompileGateError("esp-idf-source-unattested", "ESP-IDF has no .lvd-source-commit attestation")
    actual_commit = stamp.read_text(encoding="ascii", errors="strict").strip().lower()
    if (
        not re.fullmatch(r"[0-9a-f]{40}", actual_commit)
        or not re.fullmatch(r"[0-9a-f]{40}", expected_commit)
        or actual_commit != expected_commit
    ):
        raise CompileGateError(
            "esp-idf-commit-mismatch",
            f"ESP-IDF commit {actual_commit or 'invalid'} does not match locked commit {expected_commit or 'missing'}",
        )
    project_cmake = idf_path / "tools" / "cmake" / "project.cmake"
    return {
        "idfVersion": actual_version,
        "idfCommit": actual_commit,
        "idfProjectCmakeSha256": hashlib.sha256(project_cmake.read_bytes()).hexdigest(),
    }


def _run(command: list[str], cwd: Path, failure_code: str) -> str:
    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"}
    for name in ("IDF_PATH", "IDF_TOOLS_PATH", "IDF_PYTHON_ENV_PATH", "OPENOCD_SCRIPTS"):
        if os.environ.get(name):
            env[name] = os.environ[name]
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=COMPILE_TIMEOUT_SECONDS,
            check=False,
            creationflags=creationflags,
        )
    except subprocess.TimeoutExpired as exc:
        raise CompileGateError("compile-gate-timeout", "LVGL compile gate timed out") from exc
    except OSError as exc:
        raise CompileGateError("compile-gate-start-failed", f"could not start compile gate: {exc}") from exc
    output = f"{result.stdout}\n{result.stderr}".strip()
    if result.returncode != 0:
        tail = output[-MAX_LOG_CHARS:]
        raise CompileGateError(failure_code, tail or f"compile command exited with code {result.returncode}")
    return output


def _executable_path(command: str) -> Path:
    candidate = Path(command)
    resolved = candidate.resolve() if candidate.is_file() else None
    if resolved is None:
        found = shutil.which(command)
        resolved = Path(found).resolve() if found else None
    if resolved is None or not resolved.is_file():
        raise CompileGateError("compile-toolchain-unattested", f"cannot resolve toolchain executable: {command}")
    return resolved


def _tool_attestation(name: str, command: str, version: str) -> dict[str, str]:
    path = _executable_path(command)
    return {
        "name": name,
        "version": version.strip().splitlines()[0] if version.strip() else "unknown",
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _cmake_cache_toolchain(build_dir: Path, cwd: Path) -> list[dict[str, str]]:
    cache = build_dir / "CMakeCache.txt"
    if not cache.is_file():
        raise CompileGateError("compile-toolchain-unattested", "CMake did not produce a toolchain cache")
    values: dict[str, str] = {}
    for line in cache.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"^([A-Z0-9_]+):[^=]*=(.*)$", line)
        if match:
            values[match.group(1)] = match.group(2).strip()
    compiler = values.get("CMAKE_C_COMPILER", "")
    if not compiler:
        raise CompileGateError("compile-toolchain-unattested", "CMake cache has no C compiler")
    compiler_version = _run([compiler, "--version"], cwd, "compile-toolchain-invalid")
    tools = [_tool_attestation("c-compiler", compiler, compiler_version)]
    for key, name in (("CMAKE_MAKE_PROGRAM", "build-runner"), ("CMAKE_COMMAND", "cmake")):
        command = values.get(key, "")
        if command:
            tools.append(_tool_attestation(name, command, "recorded by CMake"))
    return tools


def _cmake_binary() -> str:
    configured = os.environ.get("LVGL_CMAKE_BINARY")
    binary = configured or shutil.which("cmake")
    if not binary:
        raise CompileGateError("compile-toolchain-unavailable", "CMake is required by the host compile gate")
    return binary


def _idf_binary() -> str:
    configured = os.environ.get("LVGL_IDF_PY_BINARY")
    if configured:
        return configured
    idf_path = os.environ.get("IDF_PATH", "").strip()
    from_idf = Path(idf_path) / "tools" / "idf.py" if idf_path else None
    binary = str(from_idf) if from_idf is not None and from_idf.is_file() else shutil.which("idf.py")
    if not binary:
        raise CompileGateError("compile-toolchain-unavailable", "idf.py is required by the ESP-IDF compile gate")
    return binary


def _cmake_path(path: Path) -> str:
    value = path.resolve().as_posix()
    if any(character in value for character in {'"', "\n", "\r", ";"}):
        raise CompileGateError("compile-path-invalid", "compile gate path contains unsupported characters")
    return value


def _host_harness(lvgl_source: Path) -> str:
    return f'''cmake_minimum_required(VERSION 3.16)
project(lvd_generated_ui_gate C CXX)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
add_subdirectory("{_cmake_path(lvgl_source)}" lvgl-build)
target_compile_definitions(lvgl PUBLIC LV_CONF_SKIP=1)
file(GLOB_RECURSE LVD_UI_SOURCES CONFIGURE_DEPENDS "${{CMAKE_CURRENT_SOURCE_DIR}}/ui/*.c")
add_library(lvd_generated_ui STATIC ${{LVD_UI_SOURCES}})
target_include_directories(lvd_generated_ui PUBLIC "${{CMAKE_CURRENT_SOURCE_DIR}}/ui")
target_compile_definitions(lvd_generated_ui PRIVATE LV_CONF_SKIP=1)
target_link_libraries(lvd_generated_ui PUBLIC lvgl)
'''


def _esp_idf_harness(lvgl_source: Path) -> str:
    return f'''cmake_minimum_required(VERSION 3.16)
set(EXTRA_COMPONENT_DIRS "{_cmake_path(lvgl_source)}")
include($ENV{{IDF_PATH}}/tools/cmake/project.cmake)
project(lvd_ui_gate)
'''


def _firmware_target(input_lock: Mapping[str, Any]) -> str:
    profiles = input_lock.get("profiles", {})
    firmware_record = profiles.get("firmware", {}) if isinstance(profiles, Mapping) else {}
    firmware = firmware_record.get("doc", {}) if isinstance(firmware_record, Mapping) else {}
    target = firmware.get("target", "") if isinstance(firmware, Mapping) else ""
    if not isinstance(target, str) or target not in ESP_IDF_TARGETS:
        raise CompileGateError("firmware-target-unsupported", f"unsupported ESP-IDF target: {target!r}")
    return target


def _validate_host(
    files: Mapping[str, str | bytes], source: Path, temp_root: Path,
) -> dict[str, Any]:
    cmake = _cmake_binary()
    with tempfile.TemporaryDirectory(prefix="lvgl-host-", dir=temp_root) as raw_temp:
        root = Path(raw_temp)
        ui_root = root / "ui"
        ui_root.mkdir()
        source_count = _materialize(ui_root, files)
        (root / "CMakeLists.txt").write_text(_host_harness(source), encoding="utf-8", newline="\n")
        version_output = _run([cmake, "--version"], root, "compile-toolchain-invalid")
        version_line = version_output.splitlines()[0] if version_output else "unknown"
        configure = [cmake, "-S", str(root), "-B", str(root / "build"), "-DCMAKE_BUILD_TYPE=Release"]
        if shutil.which("ninja"):
            configure.extend(["-G", "Ninja"])
        _run(configure, root, "host-configure-failed")
        toolchain = [
            _tool_attestation("cmake", cmake, version_line),
            *_cmake_cache_toolchain(root / "build", root),
        ]
        _run(
            [cmake, "--build", str(root / "build"), "--target", "lvd_generated_ui", "--parallel", "2"],
            root,
            "host-compile-failed",
        )
    return {
        "target": "host-cmake", "sourceCount": source_count, "cmake": version_line,
        "toolchain": toolchain,
    }


def _validate_esp_idf(
    files: Mapping[str, str | bytes], input_lock: Mapping[str, Any], source: Path, temp_root: Path,
) -> dict[str, Any]:
    component_cmake = files.get("CMakeLists.txt")
    if not isinstance(component_cmake, str) or "idf_component_register" not in component_cmake:
        raise CompileGateError("esp-idf-component-invalid", "generated artifact has no ESP-IDF component CMakeLists")
    idf_path_value = os.environ.get("IDF_PATH", "").strip()
    idf_path = Path(idf_path_value).resolve() if idf_path_value else None
    if idf_path is None or not (idf_path / "tools" / "cmake" / "project.cmake").is_file():
        raise CompileGateError("compile-toolchain-unavailable", "IDF_PATH does not contain ESP-IDF project.cmake")
    idf = _idf_binary()
    target = _firmware_target(input_lock)
    with tempfile.TemporaryDirectory(prefix="lvgl-esp-idf-", dir=temp_root) as raw_temp:
        root = Path(raw_temp)
        ui_root = root / "components" / "ui"
        ui_root.mkdir(parents=True)
        source_count = _materialize(ui_root, files)
        (root / "CMakeLists.txt").write_text(_esp_idf_harness(source), encoding="utf-8", newline="\n")
        main = root / "main"
        main.mkdir()
        (main / "CMakeLists.txt").write_text(
            'idf_component_register(SRCS "main.c" INCLUDE_DIRS "." REQUIRES ui)\n',
            encoding="utf-8", newline="\n",
        )
        (main / "main.c").write_text(
            '#include "ui.h"\nvoid app_main(void) { ui_init(); }\n',
            encoding="utf-8", newline="\n",
        )
        version_output = _run([idf, "--version"], root, "compile-toolchain-invalid")
        version_line = version_output.splitlines()[0] if version_output else "unknown"
        idf_attestation = _idf_attestation(idf_path, input_lock, version_line)
        _run([idf, "-C", str(root), "set-target", target], root, "esp-idf-configure-failed")
        _run([idf, "-C", str(root), "build"], root, "esp-idf-compile-failed")
        toolchain = [
            _tool_attestation("idf.py", idf, version_line),
            *_cmake_cache_toolchain(root / "build", root),
        ]
        firmware = root / "build" / "lvd_ui_gate.bin"
        sdkconfig = root / "sdkconfig"
        if not firmware.is_file() or not sdkconfig.is_file():
            raise CompileGateError(
                "esp-idf-artifact-missing", "ESP-IDF build passed without firmware binary or sdkconfig",
            )
        firmware_sha = hashlib.sha256(firmware.read_bytes()).hexdigest()
        sdkconfig_sha = hashlib.sha256(sdkconfig.read_bytes()).hexdigest()
    return {
        "target": target,
        "sourceCount": source_count,
        "idf": version_line,
        "firmwareSha256": firmware_sha,
        "sdkconfigSha256": sdkconfig_sha,
        "toolchain": toolchain,
        **idf_attestation,
    }


def validate_generated_sources(
    files: Mapping[str, str | bytes],
    input_lock: Mapping[str, Any],
    temp_root: Path,
) -> dict[str, Any]:
    """Run the configured compile policy and return a deterministic attestation."""

    policy = _policy()
    if policy == "none":
        return {
            "policy": "none",
            "status": "not-run",
            "requiredForPublish": True,
            "releaseQualified": False,
            "reason": "LVGL_BUILD_COMPILE_GATE is not configured",
        }

    source_value = os.environ.get("LVGL_HOST_SOURCE_DIR", "").strip()
    if not source_value:
        raise CompileGateError("lvgl-source-missing", "LVGL_HOST_SOURCE_DIR is required by the host compile gate")
    source = Path(source_value).resolve()
    generator = input_lock.get("generator", {})
    expected_commit = str(generator.get("lvglCommit", "")) if isinstance(generator, Mapping) else ""
    attestation = _source_attestation(source, expected_commit)
    temp_root.mkdir(parents=True, exist_ok=True)
    validation = (
        _validate_host(files, source, temp_root)
        if policy == "host"
        else _validate_esp_idf(files, input_lock, source, temp_root)
    )
    return {
        "policy": policy,
        "status": "passed",
        "requiredForPublish": True,
        "releaseQualified": policy == "esp-idf",
        **validation,
        **attestation,
    }

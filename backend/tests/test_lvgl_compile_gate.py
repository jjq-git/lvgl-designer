from pathlib import Path

import pytest

from app.tools.lvgl_builds import compile_gate


COMMIT = "85aa60d18b3d5e5588d7b247abf90198f07c8a63"
IDF_COMMIT = "296b6eab9445fd720e71aecab961e2d3fbca9944"


def _lvgl_source(root: Path, version=(9, 5, 0), attested=True) -> Path:
    source = root / "lvgl"
    source.mkdir()
    (source / "lvgl.h").write_text("#pragma once\n", encoding="utf-8")
    (source / "lv_version.h").write_text(
        "\n".join([
            f"#define LVGL_VERSION_MAJOR {version[0]}",
            f"#define LVGL_VERSION_MINOR {version[1]}",
            f"#define LVGL_VERSION_PATCH {version[2]}",
        ]) + "\n",
        encoding="utf-8",
    )
    if attested:
        (source / ".lvd-source-commit").write_text(f"{COMMIT}\n", encoding="ascii")
    return source


def test_disabled_gate_is_explicitly_not_publishable(tmp_path, monkeypatch):
    monkeypatch.setenv("LVGL_BUILD_COMPILE_GATE", "none")
    result = compile_gate.validate_generated_sources(
        {"ui.c": "void ui_init(void) {}\n"},
        {"generator": {"lvglCommit": COMMIT}},
        tmp_path,
    )
    assert result == {
        "policy": "none",
        "status": "not-run",
        "requiredForPublish": True,
        "releaseQualified": False,
        "reason": "LVGL_BUILD_COMPILE_GATE is not configured",
    }


def test_host_gate_uses_fixed_cmake_commands_and_attested_lvgl(tmp_path, monkeypatch):
    source = _lvgl_source(tmp_path)
    cmake = tmp_path / "trusted-cmake"
    compiler = tmp_path / "trusted-cc"
    cmake.write_bytes(b"cmake-binary")
    compiler.write_bytes(b"compiler-binary")
    commands = []

    def fake_run(command, cwd, failure_code):
        commands.append((command, failure_code))
        assert (cwd / "CMakeLists.txt").is_file()
        assert (cwd / "ui" / "screens" / "main.c").is_file()
        if "-S" in command:
            (cwd / "build").mkdir(exist_ok=True)
            (cwd / "build" / "CMakeCache.txt").write_text(
                f"CMAKE_C_COMPILER:FILEPATH={compiler}\nCMAKE_COMMAND:INTERNAL={cmake}\n",
                encoding="utf-8",
            )
        return "cmake version 3.28.1" if command[1:] == ["--version"] else "ok"

    monkeypatch.setenv("LVGL_BUILD_COMPILE_GATE", "host")
    monkeypatch.setenv("LVGL_HOST_SOURCE_DIR", str(source))
    monkeypatch.setenv("LVGL_CMAKE_BINARY", str(cmake))
    monkeypatch.setattr(compile_gate, "_run", fake_run)
    monkeypatch.setattr(compile_gate.shutil, "which", lambda _name: None)

    result = compile_gate.validate_generated_sources(
        {"ui.h": "#pragma once\n", "screens/main.c": "void main_create(void) {}\n"},
        {"generator": {"lvglCommit": COMMIT}},
        tmp_path / "tasks",
    )

    assert result["status"] == "passed"
    assert result["releaseQualified"] is False
    assert result["lvglVersion"] == "9.5.0"
    assert result["lvglCommit"] == COMMIT
    assert result["sourceCount"] == 1
    assert commands[0] == ([str(cmake), "--version"], "compile-toolchain-invalid")
    assert commands[1][0][0:2] == [str(cmake), "-S"]
    assert commands[3][0][-4:] == ["--target", "lvd_generated_ui", "--parallel", "2"]
    assert {tool["name"] for tool in result["toolchain"]} == {"cmake", "c-compiler"}
    assert all(len(tool["sha256"]) == 64 for tool in result["toolchain"])


def test_esp_idf_gate_builds_locked_target_and_returns_release_proof(tmp_path, monkeypatch):
    source = _lvgl_source(tmp_path)
    idf_path = tmp_path / "esp-idf"
    (idf_path / "tools" / "cmake").mkdir(parents=True)
    (idf_path / "tools" / "cmake" / "project.cmake").write_text("# trusted fixture\n", encoding="utf-8")
    (idf_path / ".lvd-source-commit").write_text(f"{IDF_COMMIT}\n", encoding="ascii")
    idf_binary = tmp_path / "trusted-idf.py"
    compiler = tmp_path / "xtensa-cc"
    cmake = tmp_path / "idf-cmake"
    idf_binary.write_bytes(b"idf-entrypoint")
    compiler.write_bytes(b"compiler-binary")
    cmake.write_bytes(b"cmake-binary")
    commands = []

    def fake_run(command, cwd, failure_code):
        commands.append((command, failure_code))
        assert (cwd / "components" / "ui" / "CMakeLists.txt").is_file()
        assert (cwd / "main" / "main.c").is_file()
        if command[-1] == "build":
            (cwd / "build").mkdir()
            (cwd / "build" / "CMakeCache.txt").write_text(
                f"CMAKE_C_COMPILER:FILEPATH={compiler}\nCMAKE_COMMAND:INTERNAL={cmake}\n",
                encoding="utf-8",
            )
            (cwd / "build" / "lvd_ui_gate.bin").write_bytes(b"firmware")
            (cwd / "sdkconfig").write_text("CONFIG_IDF_TARGET=\"esp32s3\"\n", encoding="utf-8")
        return "ESP-IDF v5.4.4" if command[1:] == ["--version"] else "ok"

    monkeypatch.setenv("LVGL_BUILD_COMPILE_GATE", "esp-idf")
    monkeypatch.setenv("LVGL_HOST_SOURCE_DIR", str(source))
    monkeypatch.setenv("IDF_PATH", str(idf_path))
    monkeypatch.setenv("LVGL_IDF_PY_BINARY", str(idf_binary))
    monkeypatch.setattr(compile_gate, "_run", fake_run)

    result = compile_gate.validate_generated_sources(
        {
            "CMakeLists.txt": "idf_component_register(SRCS \"ui.c\" INCLUDE_DIRS \".\" REQUIRES lvgl)\n",
            "ui.h": "void ui_init(void);\n",
            "ui.c": "void ui_init(void) {}\n",
        },
        {
            "generator": {
                "lvglCommit": COMMIT,
                "espIdfVersion": "5.4.4",
                "espIdfCommit": IDF_COMMIT,
            },
            "profiles": {"firmware": {"doc": {"target": "esp32s3"}}},
        },
        tmp_path / "tasks",
    )

    assert result["policy"] == "esp-idf"
    assert result["status"] == "passed"
    assert result["releaseQualified"] is True
    assert result["target"] == "esp32s3"
    assert result["idf"] == "ESP-IDF v5.4.4"
    assert result["idfVersion"] == "5.4.4"
    assert result["idfCommit"] == IDF_COMMIT
    assert result["firmwareSha256"]
    assert result["sdkconfigSha256"]
    assert {tool["name"] for tool in result["toolchain"]} == {"idf.py", "c-compiler", "cmake"}
    assert commands[1][0][-2:] == ["set-target", "esp32s3"]
    assert commands[2][0][-1] == "build"


def test_esp_idf_gate_rejects_untrusted_firmware_target_before_commands(tmp_path, monkeypatch):
    source = _lvgl_source(tmp_path)
    idf_path = tmp_path / "esp-idf"
    (idf_path / "tools" / "cmake").mkdir(parents=True)
    (idf_path / "tools" / "cmake" / "project.cmake").write_text("# trusted fixture\n", encoding="utf-8")
    (idf_path / ".lvd-source-commit").write_text(f"{IDF_COMMIT}\n", encoding="ascii")
    monkeypatch.setenv("LVGL_BUILD_COMPILE_GATE", "esp-idf")
    monkeypatch.setenv("LVGL_HOST_SOURCE_DIR", str(source))
    monkeypatch.setenv("IDF_PATH", str(idf_path))
    monkeypatch.setenv("LVGL_IDF_PY_BINARY", "trusted-idf.py")

    with pytest.raises(compile_gate.CompileGateError) as error:
        compile_gate.validate_generated_sources(
            {"CMakeLists.txt": "idf_component_register(SRCS \"ui.c\")\n", "ui.c": "x"},
            {
                "generator": {
                    "lvglCommit": COMMIT,
                    "espIdfVersion": "5.4.4",
                    "espIdfCommit": IDF_COMMIT,
                },
                "profiles": {"firmware": {"doc": {"target": "esp32s3;rm"}}},
            },
            tmp_path / "tasks",
        )
    assert error.value.code == "firmware-target-unsupported"


@pytest.mark.parametrize(
    ("version_line", "stamp", "code"),
    [
        ("ESP-IDF v5.5.0", IDF_COMMIT, "esp-idf-version-mismatch"),
        ("ESP-IDF v5.4.4", "0" * 40, "esp-idf-commit-mismatch"),
    ],
)
def test_esp_idf_attestation_must_match_locked_toolchain(tmp_path, version_line, stamp, code):
    idf_path = tmp_path / "esp-idf"
    (idf_path / "tools" / "cmake").mkdir(parents=True)
    (idf_path / "tools" / "cmake" / "project.cmake").write_text("# fixture\n", encoding="utf-8")
    (idf_path / ".lvd-source-commit").write_text(f"{stamp}\n", encoding="ascii")
    input_lock = {"generator": {
        "espIdfVersion": "5.4.4",
        "espIdfCommit": IDF_COMMIT,
    }}
    with pytest.raises(compile_gate.CompileGateError) as error:
        compile_gate._idf_attestation(idf_path, input_lock, version_line)
    assert error.value.code == code


@pytest.mark.parametrize(
    ("version", "attested", "code"),
    [((9, 4, 0), True, "lvgl-source-version-mismatch"), ((9, 5, 0), False, "lvgl-source-unattested")],
)
def test_host_gate_rejects_wrong_or_unattested_lvgl(tmp_path, monkeypatch, version, attested, code):
    source = _lvgl_source(tmp_path, version=version, attested=attested)
    monkeypatch.setenv("LVGL_BUILD_COMPILE_GATE", "host")
    monkeypatch.setenv("LVGL_HOST_SOURCE_DIR", str(source))
    with pytest.raises(compile_gate.CompileGateError) as error:
        compile_gate.validate_generated_sources(
            {"ui.c": "void ui_init(void) {}\n"},
            {"generator": {"lvglCommit": COMMIT}},
            tmp_path / "tasks",
        )
    assert error.value.code == code

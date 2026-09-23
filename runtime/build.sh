#!/usr/bin/env bash
# LVGL Web Designer — WASM runtime build
#
#   bash runtime/build.sh                      # 编译，产物落 packages/lvgl-runtime/dist/
#   bash runtime/build.sh --check              # 只校验环境与版本，不编译（CI / 无 emsdk 机器可跑）
#   LVGL_TAG=v9.4.0 bash runtime/build.sh      # 临时切版本（读旧工程用）
#   EMSDK_DIR=/opt/emsdk bash runtime/build.sh
#
# 依赖：emsdk（emcc ≥ 3.1）+ cmake + ninja/make + git（首次自动 clone LVGL）。
#
# 本脚本复用固件仓库 simulator/build_web.sh 已验证的四条原则（方案 §2.5 要求复用而非另起炉灶）：
#   1. LVGL_TAG 固定版本、可覆盖      2. EMSDK_DIR 参数化，找不到就显式失败
#   3. 多源回退（内网 Gitea 优先）    4. ninja/make 生成器回退
# 在此之上补两项方案 §6.2 要求、而固件脚本没有的：
#   5. 版本断言：vendor/lvgl 实际版本与 LVGL_TAG 不符即失败（旧脚本会静默编错版本）
#   6. 构建 manifest：记录 LVGL commit、lv_conf.h 哈希、emcc 版本，供截图对拍溯源
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$RUNTIME_DIR")"
DIST_DIR="$REPO_ROOT/packages/lvgl-runtime/dist"
BUILD_DIR="${BUILD_DIR:-$RUNTIME_DIR/build}"

# 目标版本 = 产品基线 9.5.0（docs/lvgl-version-baseline.md §1.1）。
# 9.5 使用 preview_host.c + preview_driver.c，不依赖 XML。
# 9.4 只作为显式迁移构建，继续使用 legacy XML bridge。
LVGL_TAG="${LVGL_TAG:-v9.5.0}"
LVGL_DIR="${LVGL_DIR:-$REPO_ROOT/vendor/lvgl}"

CHECK_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK_ONLY=1 ;;
        -h|--help) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "未知参数：$arg（可用：--check / --help）" >&2; exit 2 ;;
    esac
done

die() { echo "错误：$*" >&2; exit 1; }

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum   >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
    else echo "unavailable"; fi
}

# ── LVGL 源码 ─────────────────────────────────────────────────────────────────
# 内网 Gitea 有镜像，优先走它（从 github.com 直接 clone 经常断在 sideband packet）。
LVGL_URLS=(
    "${LVGL_URL:-}"
    "http://192.168.1.88:3000/learn_data_github/lvgl.git"
    "https://github.com/lvgl/lvgl.git"
)

if [ ! -f "$LVGL_DIR/lvgl.h" ]; then
    [ "$CHECK_ONLY" = 1 ] && die "缺 LVGL 源码：$LVGL_DIR（去掉 --check 会自动 clone $LVGL_TAG）"
    command -v git >/dev/null 2>&1 || die "需要 git 才能 clone LVGL"
    for url in "${LVGL_URLS[@]}"; do
        [ -n "$url" ] || continue
        echo "clone LVGL $LVGL_TAG <- $url"
        rm -rf "$LVGL_DIR"
        if git clone --depth 1 --single-branch --branch "$LVGL_TAG" "$url" "$LVGL_DIR"; then break; fi
    done
    [ -f "$LVGL_DIR/lvgl.h" ] || die "LVGL clone 全部失败（试过 ${#LVGL_URLS[@]} 个源）"
fi

# ── 版本断言 ──────────────────────────────────────────────────────────────────
# 旧脚本没有这一步：vendor/lvgl 一旦是别的版本，会静默编出一个版本不明的产物，
# 而截图对拍又要求「发布构建必须记录精确版本」（方案 §2.4、§6.2）。
version_of() {
    local h="$LVGL_DIR/lv_version.h"
    [ -f "$h" ] || { echo "unknown"; return; }
    local maj min pat
    maj=$(grep -oE '#define +LVGL_VERSION_MAJOR +[0-9]+' "$h" | grep -oE '[0-9]+$')
    min=$(grep -oE '#define +LVGL_VERSION_MINOR +[0-9]+' "$h" | grep -oE '[0-9]+$')
    pat=$(grep -oE '#define +LVGL_VERSION_PATCH +[0-9]+' "$h" | grep -oE '[0-9]+$')
    echo "${maj}.${min}.${pat}"
}

ACTUAL_VERSION="$(version_of)"
EXPECTED_VERSION="${LVGL_TAG#v}"
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
    die "LVGL 版本不符：$LVGL_DIR 实为 $ACTUAL_VERSION，期望 $EXPECTED_VERSION（LVGL_TAG=$LVGL_TAG）
     修复：rm -rf '$LVGL_DIR' 后重跑，或改 LVGL_TAG 与现有源码一致"
fi

LVGL_COMMIT="$(git -C "$LVGL_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "LVGL $ACTUAL_VERSION @ ${LVGL_COMMIT:0:12}  ($LVGL_DIR)"

LEGACY_XML_BRIDGE=OFF
RUNTIME_MODE=preview-program
case "$ACTUAL_VERSION" in
    9.4.*) LEGACY_XML_BRIDGE=ON; RUNTIME_MODE=legacy-xml ;;
    9.5.*) ;;
    *) die "不支持的 runtime LVGL 版本：$ACTUAL_VERSION（支持 9.4.x 迁移、9.5.x 产品基线）" ;;
esac

# ── emsdk ─────────────────────────────────────────────────────────────────────
EMSDK_DIR="${EMSDK_DIR:-/opt/emsdk}"
if ! command -v emcc >/dev/null 2>&1; then
    if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
        # shellcheck disable=SC1091
        source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
    elif [ "$CHECK_ONLY" = 1 ]; then
        echo "提示：本机无 emcc，也没有 $EMSDK_DIR/emsdk_env.sh（--check 模式下不算失败）"
    else
        # 旧脚本这里是 `source <某台开发机的绝对路径>/emsdk_env.sh 2>/dev/null`：
        # 路径写死到单台机器，且失败被吞掉，后面 emcmake 才报一个看不懂的错。
        die "找不到 emsdk。装好后用 EMSDK_DIR=/你的/emsdk 重跑，或先 source emsdk_env.sh"
    fi
fi

if command -v emcc >/dev/null 2>&1; then
    # 系统级 emsdk 的 cache 目录常常只读，强制指到用户目录，否则 emcc 第一次跑就报错。
    export EM_CACHE="${EM_CACHE:-$HOME/.emscripten_cache}"
    mkdir -p "$EM_CACHE"
    EMCC_VERSION="$(emcc --version | head -1)"
    EMCC_PATH="$(command -v emcc)"
    EMCC_SHA="$(sha256_of "$EMCC_PATH")"
    echo "$EMCC_VERSION"
else
    EMCC_VERSION="unavailable"
    EMCC_PATH="unavailable"
    EMCC_SHA="unavailable"
fi

LV_CONF_SHA="$(sha256_of "$RUNTIME_DIR/lv_conf.h")"

if [ "$CHECK_ONLY" = 1 ]; then
    echo
    echo "--check 通过："
    echo "  LVGL_TAG      $LVGL_TAG  (实际 $ACTUAL_VERSION)"
    echo "  LVGL_DIR      $LVGL_DIR"
    echo "  LVGL commit   $LVGL_COMMIT"
    echo "  lv_conf.h     sha256:$LV_CONF_SHA"
    echo "  emcc          $EMCC_VERSION"
    echo "  runtime mode  $RUNTIME_MODE"
    exit 0
fi

command -v cmake >/dev/null 2>&1 || die "需要 cmake"
CMAKE_PATH="$(command -v cmake)"
CMAKE_VERSION="$(cmake --version | head -1)"
CMAKE_SHA="$(sha256_of "$CMAKE_PATH")"

# ── 编译 ──────────────────────────────────────────────────────────────────────
GEN=(-G "Unix Makefiles")
command -v ninja >/dev/null 2>&1 && GEN=(-G Ninja)
NINJA_PATH="$(command -v ninja 2>/dev/null || true)"
NINJA_VERSION="$([ -n "$NINJA_PATH" ] && ninja --version || echo unavailable)"
NINJA_SHA="$([ -n "$NINJA_PATH" ] && sha256_of "$NINJA_PATH" || echo unavailable)"

JOBS="$( (command -v nproc >/dev/null 2>&1 && nproc) || echo 4 )"

cd "$RUNTIME_DIR"
emcmake cmake -B "$BUILD_DIR" "${GEN[@]}" -DCMAKE_BUILD_TYPE=Release \
    -DLVD_LVGL_DIR="$LVGL_DIR" -DLVD_LEGACY_XML_BRIDGE="$LEGACY_XML_BRIDGE"
cmake --build "$BUILD_DIR" -j "$JOBS"

mkdir -p "$DIST_DIR"
cp "$BUILD_DIR/lvgl_runtime.mjs" "$BUILD_DIR/lvgl_runtime.wasm" "$DIST_DIR/"

# ── 构建 manifest ─────────────────────────────────────────────────────────────
# 方案 §6.2:「像素一致」以截图 diff 为准，而 diff 结果必须能溯源到具体构建。
# 这里记录脚本能确定的部分；字体/图片转换参数哈希由素材管线在导出时补。
cat > "$DIST_DIR/build-manifest.json" <<JSON
{
  "lvglTag": "$LVGL_TAG",
  "lvglVersion": "$ACTUAL_VERSION",
  "lvglCommit": "$LVGL_COMMIT",
  "lvConfSha256": "$LV_CONF_SHA",
  "emcc": "$EMCC_VERSION",
  "toolchain": {
    "emcc": {"version": "$EMCC_VERSION", "path": "$EMCC_PATH", "sha256": "$EMCC_SHA"},
    "cmake": {"version": "$CMAKE_VERSION", "path": "$CMAKE_PATH", "sha256": "$CMAKE_SHA"},
    "ninja": {"version": "$NINJA_VERSION", "path": "$NINJA_PATH", "sha256": "$NINJA_SHA"}
  },
  "runtimeMode": "$RUNTIME_MODE",
  "rendererBackend": "sw",
  "displayHost": "canvas-flush",
  "inputHost": "pointer-events",
  "note": "字体/图片转换参数哈希与 Display Color Format 由素材管线与 BuildTarget 补全"
}
JSON

echo
echo "OK -> $DIST_DIR"
ls -l "$DIST_DIR"/lvgl_runtime.mjs "$DIST_DIR"/lvgl_runtime.wasm "$DIST_DIR"/build-manifest.json \
  | awk '{print "  " $9 "  " $5 "B"}'

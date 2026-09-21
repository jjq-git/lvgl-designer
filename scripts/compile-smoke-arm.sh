#!/usr/bin/env bash
# compile-smoke-arm.sh — 把 golden 导出的生成 C 用 arm-none-eabi-gcc 交叉编译(Cortex-M4F)。
# 目标:验证导出的 C 对 STM32 类目标开箱即编,-Werror 零告警(LVGL 本体头文件走 -isystem 屏蔽)。
# LV_USE_OBJ_NAME=1 与 =0 各编一遍;只编到 .o,不链接。
#
# 用法:
#   scripts/compile-smoke-arm.sh                # 默认编 packages/codegen golden 全部用例
#   scripts/compile-smoke-arm.sh <dir> [dir...] # 指定含 .c 的目录(每个目录同时作为 -I 头搜索路径)
# 环境变量:
#   ARM_CC     交叉编译器(默认自动找 PATH 里的 arm-none-eabi-gcc,再找 ~/toolchains/xpack-arm-none-eabi-gcc-*/bin)
#   ARM_FLAGS  覆盖默认目标机器参数(默认 cortex-m4 hard-float)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GOLDEN="$ROOT/packages/codegen/src/__tests__/golden"
LV_CONF="$ROOT/packages/codegen/ci/lv_conf_ci.h"
LVGL_DIR="$ROOT/vendor/lvgl"
OUT="${TMPDIR:-/tmp}/lvd-compile-smoke-arm"

# ---- 找交叉编译器 ----
ARM_CC="${ARM_CC:-}"
if [ -z "$ARM_CC" ]; then
    if command -v arm-none-eabi-gcc >/dev/null 2>&1; then
        ARM_CC="arm-none-eabi-gcc"
    else
        for cand in "$HOME"/toolchains/xpack-arm-none-eabi-gcc-*/bin/arm-none-eabi-gcc; do
            [ -x "$cand" ] && ARM_CC="$cand"
        done
    fi
fi
if [ -z "$ARM_CC" ] || ! "$ARM_CC" --version >/dev/null 2>&1; then
    echo "找不到 arm-none-eabi-gcc(PATH 或 ~/toolchains/xpack-arm-none-eabi-gcc-*/bin),或设 ARM_CC=" >&2
    exit 1
fi

# ---- 目标机器参数(STM32F4 档:Cortex-M4F hard-float) ----
ARM_FLAGS="${ARM_FLAGS:--mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16}"

# ---- 待编目录:参数指定,否则 golden 全部用例的 c/ 目录 ----
declare -a SRC_DIRS=()
if [ "$#" -gt 0 ]; then
    for d in "$@"; do
        [ -d "$d" ] || { echo "目录不存在: $d" >&2; exit 1; }
        SRC_DIRS+=("$(cd "$d" && pwd)")
    done
else
    if [ ! -d "$GOLDEN" ]; then
        echo "golden 目录不存在,先跑:pnpm --filter @lvd/codegen test" >&2
        exit 1
    fi
    while IFS= read -r -d '' d; do
        SRC_DIRS+=("$d")
    done < <(find "$GOLDEN" -mindepth 2 -maxdepth 2 -type d -name c -print0 | sort -z)
fi

rm -rf "$OUT"
mkdir -p "$OUT"

total=0
fail=0

for objname in 1 0; do
    for cdir in "${SRC_DIRS[@]}"; do
        case_name="$(basename "$(dirname "$cdir")")-$(basename "$cdir")"
        while IFS= read -r -d '' src; do
            rel="${src#"$cdir"/}"
            obj="$OUT/objname${objname}-${case_name}-$(echo "$rel" | tr '/' '_').o"
            total=$((total + 1))
            if ! "$ARM_CC" -c "$src" -o "$obj" \
                $ARM_FLAGS \
                -std=c11 -Os -Wall -Wextra -Werror \
                -ffunction-sections -fdata-sections \
                -I "$cdir" -isystem "$LVGL_DIR" \
                -DLV_LVGL_H_INCLUDE_SIMPLE \
                -DLV_CONF_PATH="\"$LV_CONF\"" \
                -DLV_USE_OBJ_NAME="$objname"; then
                echo "FAIL [LV_USE_OBJ_NAME=$objname] $case_name/$rel" >&2
                fail=$((fail + 1))
            fi
        done < <(find "$cdir" -name '*.c' -print0 | sort -z)
    done
done

echo "compile-smoke-arm: $((total - fail))/$total OK (LV_USE_OBJ_NAME=1/0 双配置, cc=$("$ARM_CC" -dumpversion), flags=$ARM_FLAGS, -Os -Wall -Wextra -Werror)"
[ "$fail" -eq 0 ]

#!/usr/bin/env bash
# compile-smoke.sh — 把 @lvd/codegen golden 用例的生成 C 用 host gcc 真编译。
# LV_USE_OBJ_NAME=1 与 =0 各编一遍(验证 lv_obj_set_name 的宏守卫),-Werror。
# 前置:golden 已录制(pnpm --filter @lvd/codegen test)。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GOLDEN="$ROOT/packages/codegen/src/__tests__/golden"
LV_CONF="$ROOT/packages/codegen/ci/lv_conf_ci.h"
LVGL_DIR="$ROOT/vendor/lvgl"
OUT="${TMPDIR:-/tmp}/lvd-compile-smoke"

CC="${CC:-gcc}"

if [ ! -d "$GOLDEN" ]; then
    echo "golden 目录不存在,先跑:pnpm --filter @lvd/codegen test" >&2
    exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

total=0
fail=0

for objname in 1 0; do
    for case_dir in "$GOLDEN"/*/; do
        case_name="$(basename "$case_dir")"
        cdir="$case_dir/c"
        [ -d "$cdir" ] || continue
        while IFS= read -r -d '' src; do
            rel="${src#"$cdir"/}"
            obj="$OUT/objname${objname}-${case_name}-$(echo "$rel" | tr '/' '_').o"
            total=$((total + 1))
            if ! "$CC" -c "$src" -o "$obj" \
                -std=c11 -Wall -Wextra -Werror \
                -I "$cdir" -I "$LVGL_DIR" \
                -DLV_LVGL_H_INCLUDE_SIMPLE \
                -DLV_CONF_PATH="\"$LV_CONF\"" \
                -DLV_USE_OBJ_NAME="$objname"; then
                echo "FAIL [LV_USE_OBJ_NAME=$objname] $case_name/$rel" >&2
                fail=$((fail + 1))
            fi
        done < <(find "$cdir" -name '*.c' -print0 | sort -z)
    done
done

echo "compile-smoke: $((total - fail))/$total OK (LV_USE_OBJ_NAME=1 与 =0 各一遍, cc=$CC, -Wall -Wextra -Werror)"
[ "$fail" -eq 0 ]

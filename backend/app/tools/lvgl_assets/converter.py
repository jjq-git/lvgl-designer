"""Deterministic raster-to-LVGL-9.5 C conversion for formal builds."""

from __future__ import annotations

import io
import json
import re
from typing import Any

from PIL import Image, UnidentifiedImageError

from . import store


CODE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_777_216
INDEXED_FORMAT_BITS = {"I1": 1, "I2": 2, "I4": 4, "I8": 8}
SUPPORTED_FORMATS = {"RGB565", "RGB565A8", "ARGB8888", "A8", *INDEXED_FORMAT_BITS}


class AssetConversionError(store.AssetStoreError):
    pass


def _indexed_pixel_bytes(
    rgba: Image.Image, color_format: str, requested_stride: Any, dither: bool,
) -> tuple[bytes, int, int]:
    bits = INDEXED_FORMAT_BITS[color_format]
    palette_size = 1 << bits
    quantized = rgba.quantize(
        colors=palette_size,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE,
    )
    rgba_palette = quantized.getpalette("RGBA")[:palette_size * 4]
    rgba_palette.extend([0] * (palette_size * 4 - len(rgba_palette)))
    # LVGL stores indexed palettes as lv_color32_t, whose byte layout is BGRA.
    palette = bytes(
        channel
        for offset in range(0, len(rgba_palette), 4)
        for channel in (
            rgba_palette[offset + 2], rgba_palette[offset + 1],
            rgba_palette[offset], rgba_palette[offset + 3],
        )
    )
    width, height = rgba.size
    minimum_stride = (width * bits + 7) // 8
    stride = requested_stride if isinstance(requested_stride, int) else minimum_stride
    if stride < minimum_stride or stride > 65535:
        raise AssetConversionError("asset-stride-invalid", f"image stride must be between {minimum_stride} and 65535")
    mask = palette_size - 1
    indices = list(quantized.getdata())
    rows: list[bytes] = []
    for y in range(height):
        packed = bytearray(minimum_stride)
        for x in range(width):
            index = indices[y * width + x] & mask
            bit_offset = x * bits
            byte_index = bit_offset // 8
            shift = 8 - bits - (bit_offset % 8)
            packed[byte_index] |= index << shift
        rows.append(bytes(packed) + bytes(stride - minimum_stride))
    return palette + b"".join(rows), stride, palette_size


def _pixel_bytes(image: Image.Image, color_format: str, requested_stride: Any, dither: bool) -> tuple[bytes, int, int]:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.tobytes()

    if color_format == "ARGB8888":
        minimum_stride = width * 4
        rows = []
        for y in range(height):
            source = pixels[y * width * 4:(y + 1) * width * 4]
            rows.append(bytes(channel for offset in range(0, len(source), 4)
                              for channel in (source[offset + 2], source[offset + 1],
                                              source[offset], source[offset + 3])))
    elif color_format in {"RGB565", "RGB565A8"}:
        minimum_stride = width * 2
        rows = []
        alpha_rows: list[bytes] = []
        for y in range(height):
            rgb = bytearray()
            alpha = bytearray()
            source = pixels[y * width * 4:(y + 1) * width * 4]
            for offset in range(0, len(source), 4):
                red, green, blue, opacity = source[offset:offset + 4]
                packed = ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3)
                rgb.extend((packed & 0xFF, packed >> 8))
                alpha.append(opacity)
            rows.append(bytes(rgb))
            alpha_rows.append(bytes(alpha))
    elif color_format == "A8":
        minimum_stride = width
        rows = [pixels[y * width * 4 + 3:(y + 1) * width * 4:4] for y in range(height)]
    elif color_format in INDEXED_FORMAT_BITS:
        return _indexed_pixel_bytes(rgba, color_format, requested_stride, dither)
    else:
        raise AssetConversionError(
            "asset-color-format-unsupported",
            f"raster conversion does not yet support {color_format}; supported: {', '.join(sorted(SUPPORTED_FORMATS))}",
        )

    stride = requested_stride if isinstance(requested_stride, int) else minimum_stride
    if stride < minimum_stride or stride > 65535:
        raise AssetConversionError("asset-stride-invalid", f"image stride must be between {minimum_stride} and 65535")
    padding = bytes(stride - minimum_stride)
    data = b"".join(row + padding for row in rows)
    if color_format == "RGB565A8":
        if stride % 2 != 0:
            raise AssetConversionError("asset-stride-invalid", "RGB565A8 stride must be even")
        alpha_stride = stride // 2
        if alpha_stride < width:
            raise AssetConversionError("asset-stride-invalid", "RGB565A8 alpha stride is smaller than image width")
        alpha_padding = bytes(alpha_stride - width)
        data += b"".join(row + alpha_padding for row in alpha_rows)
    return data, stride, 0


def _c_array(data: bytes) -> str:
    lines = []
    for offset in range(0, len(data), 16):
        lines.append("    " + "".join(f"0x{value:02x}," for value in data[offset:offset + 16]))
    return "\n".join(lines)


def convert_raster(payload: bytes, code_name: str, conv: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if not CODE_NAME_RE.fullmatch(code_name):
        raise AssetConversionError("asset-code-name-invalid", f"image codeName is not a safe C identifier: {code_name!r}")
    color_format = conv.get("colorFormat", "ARGB8888")
    if not isinstance(color_format, str) or color_format not in SUPPORTED_FORMATS:
        raise AssetConversionError(
            "asset-color-format-unsupported",
            f"image {code_name} requests unsupported color format: {color_format}",
        )
    try:
        with Image.open(io.BytesIO(payload)) as opened:
            width, height = opened.size
            if width < 1 or height < 1 or width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                raise AssetConversionError("asset-image-dimensions", f"image dimensions are out of range: {width}x{height}")
            if width * height > MAX_IMAGE_PIXELS:
                raise AssetConversionError("asset-image-pixels", "decoded image exceeds pixel limit")
            opened.load()
            data, stride, palette_size = _pixel_bytes(
                opened, color_format, conv.get("stride"), conv.get("dither") is True,
            )
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AssetConversionError("asset-image-decode", f"could not decode raster image {code_name}") from exc

    symbol = f"img_{code_name}"
    content = f'''/* Generated deterministically for LVGL 9.5.0. */
#include "../images.h"

#ifndef LV_ATTRIBUTE_MEM_ALIGN
#define LV_ATTRIBUTE_MEM_ALIGN
#endif
#ifndef LV_ATTRIBUTE_LARGE_CONST
#define LV_ATTRIBUTE_LARGE_CONST
#endif

static const LV_ATTRIBUTE_MEM_ALIGN LV_ATTRIBUTE_LARGE_CONST uint8_t {symbol}_map[] = {{
{_c_array(data)}
}};

const lv_image_dsc_t {symbol} = {{
    .header = {{
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_{color_format},
        .flags = 0,
        .w = {width},
        .h = {height},
        .stride = {stride},
        .reserved_2 = 0,
    }},
    .data_size = sizeof({symbol}_map),
    .data = {symbol}_map,
    .reserved = NULL,
}};
'''
    return content, {
        "codeName": code_name,
        "colorFormat": color_format,
        "width": width,
        "height": height,
        "stride": stride,
        "dataSize": len(data),
        **({"paletteSize": palette_size} if palette_size else {}),
    }


def convert_lottie(payload: bytes, code_name: str) -> tuple[str, dict[str, Any]]:
    if not CODE_NAME_RE.fullmatch(code_name):
        raise AssetConversionError("asset-code-name-invalid", f"Lottie codeName is not a safe C identifier: {code_name!r}")
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AssetConversionError("asset-lottie-decode", f"could not decode Lottie JSON {code_name}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("layers"), list):
        raise AssetConversionError("asset-lottie-invalid", f"Lottie document must contain a layers array: {code_name}")
    symbol = f"lottie_{code_name}"
    content = f'''/* Generated deterministically for LVGL 9.5.0. */
#include <stddef.h>
#include <stdint.h>

const uint8_t {symbol}[] = {{
{_c_array(payload)}
}};
const size_t {symbol}_size = sizeof({symbol});
'''
    return content, {
        "codeName": code_name,
        "kind": "lottie",
        "dataSize": len(payload),
        "layerCount": len(document["layers"]),
    }


def convert_locked_assets(owner_user_id: int, locks: list[dict[str, Any]]) -> tuple[dict[str, str], list[dict[str, Any]]]:
    files: dict[str, str] = {}
    manifest: list[dict[str, Any]] = []
    for entry in locks:
        category = entry.get("category")
        if category == "fonts":
            # Font C sources are produced inside the fixed Node worker by the
            # bundled lv_font_conv/FreeType pipeline.
            continue
        if category != "images":
            raise AssetConversionError(
                "asset-category-unimplemented",
                f"formal conversion is not implemented for asset category {category}: {entry.get('id')}",
                entry.get("sha256"),
            )
        code_name = entry.get("codeName")
        if not isinstance(code_name, str):
            raise AssetConversionError("asset-code-name-required", f"image requires codeName: {entry.get('id')}")
        _metadata, payload = store.read_verified(
            owner_user_id, str(entry.get("sha256", "")), entry.get("byteSize"),
        )
        conv = entry.get("conv", {})
        content, converted = (
            convert_lottie(payload, code_name)
            if conv.get("kind") == "lottie"
            else convert_raster(payload, code_name, conv)
        )
        path = f"images/{code_name}.c"
        if path in files:
            raise AssetConversionError("duplicate-asset-output", f"duplicate converted asset path: {path}")
        files[path] = content
        manifest.append({
            "id": entry.get("id"),
            "sha256": entry.get("sha256"),
            "output": path,
            **converted,
        })
    return files, manifest

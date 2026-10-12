"""Generate the small product-owned icon font used by quiet-pod demos."""

from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


UNITS_PER_EM = 1024
DOOR_OPEN_CODEPOINT = 0xF52B
DOOR_OPEN_GLYPH = "podsc-door-open"


def _polygon(pen: TTGlyphPen, points: list[tuple[int, int]]) -> None:
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()


def _empty_glyph():
    return TTGlyphPen(None).glyph()


def _door_open_glyph():
    pen = TTGlyphPen(None)

    # Cabin frame. The right post remains visible behind the opened door leaf.
    _polygon(pen, [(110, 100), (180, 100), (180, 920), (110, 920)])
    _polygon(pen, [(110, 850), (810, 850), (810, 920), (110, 920)])
    _polygon(pen, [(740, 100), (810, 100), (810, 920), (740, 920)])

    # Open door leaf, drawn as a hollow perspective quadrilateral.
    _polygon(pen, [(280, 140), (340, 148), (340, 832), (280, 842)])
    _polygon(pen, [(660, 74), (720, 65), (720, 895), (660, 886)])
    _polygon(pen, [(280, 140), (720, 65), (720, 130), (280, 205)])
    _polygon(pen, [(280, 777), (720, 850), (720, 915), (280, 842)])

    # Door handle.
    pen.moveTo((625, 480))
    pen.qCurveTo((625, 520), (585, 520))
    pen.qCurveTo((545, 520), (545, 480))
    pen.qCurveTo((545, 440), (585, 440))
    pen.qCurveTo((625, 440), (625, 480))
    pen.closePath()
    return pen.glyph()


def build_font(ttf_path: Path, woff_path: Path | None) -> None:
    glyph_order = [".notdef", DOOR_OPEN_GLYPH]
    font = FontBuilder(UNITS_PER_EM, isTTF=True)
    font.setupGlyphOrder(glyph_order)
    font.setupCharacterMap({DOOR_OPEN_CODEPOINT: DOOR_OPEN_GLYPH})
    font.setupGlyf({".notdef": _empty_glyph(), DOOR_OPEN_GLYPH: _door_open_glyph()})
    font.setupHorizontalMetrics({name: (920, 0) for name in glyph_order})
    font.setupHorizontalHeader(ascent=960, descent=-64)
    font.setupOS2(
        sTypoAscender=960,
        sTypoDescender=-64,
        usWinAscent=960,
        usWinDescent=64,
    )
    font.setupNameTable({
        "familyName": "PodsC Symbols",
        "styleName": "Regular",
        "uniqueFontIdentifier": "PodsC Symbols Regular 1.0",
        "fullName": "PodsC Symbols Regular",
        "psName": "PodsCSymbols-Regular",
        "version": "Version 1.0",
    })
    font.setupPost()
    font.setupMaxp()
    ttf_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(ttf_path)

    if woff_path is not None:
        woff_path.parent.mkdir(parents=True, exist_ok=True)
        web_font = TTFont(ttf_path)
        web_font.flavor = "woff"
        web_font.save(woff_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ttf", type=Path, required=True)
    parser.add_argument("--woff", type=Path)
    args = parser.parse_args()
    build_font(args.ttf, args.woff)


if __name__ == "__main__":
    main()

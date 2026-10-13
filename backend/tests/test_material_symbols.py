import asyncio

import pytest

from app.tools import material_symbols


SAMPLE_MODULE = """
export const materialSymbolsSvg = {
  'home': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h2v2Z"/></svg>',
  'wifi_off': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h4"/></svg>',
};
"""


def test_material_symbols_catalog_parser_and_svg_sanitizer():
    parsed = material_symbols.parse_catalog_module(SAMPLE_MODULE)
    assert sorted(parsed) == ["home", "wifi_off"]
    assert material_symbols.sanitize_svg(parsed["home"]).startswith("<svg")

    with pytest.raises(material_symbols.MaterialSymbolsError) as unsafe:
        material_symbols.sanitize_svg('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>')
    assert unsafe.value.code == "material-symbols-svg-unsafe"


def test_material_symbols_search_and_lookup_use_cached_snapshot(monkeypatch):
    calls = 0

    async def download():
        nonlocal calls
        calls += 1
        return SAMPLE_MODULE

    monkeypatch.setattr(material_symbols, "_cache", None)
    monkeypatch.setattr(material_symbols, "_download_catalog", download)
    names, total = asyncio.run(material_symbols.search_icons("wifi", 20))
    assert names == ["wifi_off"]
    assert total == 1
    names, total = asyncio.run(material_symbols.search_icons("", 1, 1))
    assert names == ["wifi_off"]
    assert total == 2
    assert "<path" in asyncio.run(material_symbols.icon_svg("home"))
    assert calls == 1

    with pytest.raises(material_symbols.MaterialSymbolsError) as missing:
        asyncio.run(material_symbols.icon_svg("missing"))
    assert missing.value.code == "material-symbols-not-found"

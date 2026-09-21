import hashlib
import io

import pytest
from PIL import Image

from app.tools.lvgl_assets import converter, store


def _png() -> bytes:
    image = Image.new("RGBA", (2, 1))
    image.putdata([(255, 0, 0, 255), (0, 255, 0, 128)])
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()


def test_raster_converter_emits_lvgl95_argb8888_descriptor():
    content, manifest = converter.convert_raster(_png(), "logo", {"colorFormat": "ARGB8888"})
    assert "const lv_image_dsc_t img_logo" in content
    assert ".magic = LV_IMAGE_HEADER_MAGIC" in content
    assert ".cf = LV_COLOR_FORMAT_ARGB8888" in content
    assert ".stride = 8" in content
    assert "0x00,0x00,0xff,0xff,0x00,0xff,0x00,0x80," in content
    assert manifest == {
        "codeName": "logo", "colorFormat": "ARGB8888",
        "width": 2, "height": 1, "stride": 8, "dataSize": 8,
    }


def test_raster_converter_emits_rgb565_and_separate_alpha_plane():
    content, manifest = converter.convert_raster(_png(), "logo", {"colorFormat": "RGB565A8"})
    assert ".cf = LV_COLOR_FORMAT_RGB565A8" in content
    assert ".stride = 4" in content
    assert "0x00,0xf8,0xe0,0x07,0xff,0x80," in content
    assert manifest["dataSize"] == 6


def test_locked_conversion_reads_owner_scoped_cas(tmp_path, monkeypatch):
    data_dir = tmp_path / "assets"
    monkeypatch.setattr(store, "DATA_DIR", data_dir)
    monkeypatch.setattr(store, "DB_PATH", data_dir / "assets.db")
    monkeypatch.setattr(store, "BLOB_ROOT", data_dir / "blobs")
    payload = _png()
    sha256 = hashlib.sha256(payload).hexdigest()
    store.put_asset(7, sha256, payload, "logo.png", "image/png")
    locks = [{
        "category": "images", "id": "image:logo", "codeName": "logo",
        "sha256": sha256, "byteSize": len(payload), "conv": {"colorFormat": "RGB565"},
    }]
    files, manifest = converter.convert_locked_assets(7, locks)
    assert list(files) == ["images/logo.c"]
    assert manifest[0]["sha256"] == sha256
    with pytest.raises(store.AssetStoreError) as other_owner:
        converter.convert_locked_assets(8, locks)
    assert other_owner.value.code == "asset-not-found"


def test_unimplemented_resource_kinds_fail_explicitly():
    with pytest.raises(converter.AssetConversionError) as unsupported:
        converter.convert_raster(_png(), "logo", {"colorFormat": "L8"})
    assert unsupported.value.code == "asset-color-format-unsupported"


@pytest.mark.parametrize(("color_format", "stride", "palette_size"), [
    ("I1", 1, 2), ("I2", 1, 4), ("I4", 1, 16), ("I8", 2, 256),
])
def test_indexed_converter_emits_palette_and_packed_pixels(color_format, stride, palette_size):
    content, manifest = converter.convert_raster(
        _png(), "logo", {"colorFormat": color_format, "dither": False},
    )
    assert f".cf = LV_COLOR_FORMAT_{color_format}" in content
    assert f".stride = {stride}" in content
    assert manifest["paletteSize"] == palette_size
    assert manifest["dataSize"] == palette_size * 4 + stride


def test_lottie_converter_validates_json_and_emits_expected_symbols():
    payload = b'{"v":"5.7.0","layers":[]}'
    content, manifest = converter.convert_lottie(payload, "pulse")
    assert "const uint8_t lottie_pulse[]" in content
    assert "const size_t lottie_pulse_size = sizeof(lottie_pulse);" in content
    assert manifest == {
        "codeName": "pulse", "kind": "lottie", "dataSize": len(payload), "layerCount": 0,
    }
    with pytest.raises(converter.AssetConversionError) as invalid:
        converter.convert_lottie(b'{"v":"5.7.0"}', "pulse")
    assert invalid.value.code == "asset-lottie-invalid"

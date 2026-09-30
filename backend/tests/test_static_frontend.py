from fastapi.testclient import TestClient

from app import create_app


def test_svg_static_assets_use_browser_decodable_media_type(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (tmp_path / "frame.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        encoding="utf-8",
    )
    monkeypatch.setenv("LVD_STATIC_DIR", str(tmp_path))

    with TestClient(create_app()) as client:
        response = client.get("/frame.svg")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"

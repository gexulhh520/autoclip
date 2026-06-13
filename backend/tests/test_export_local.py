"""本地导出目录工具测试。"""
from pathlib import Path

from backend.utils.export_local import copy_export_outputs, get_default_editor_export_dir


def test_get_default_editor_export_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.utils.export_local.get_data_directory",
        lambda: tmp_path,
    )
    export_dir = get_default_editor_export_dir()
    assert export_dir == (tmp_path / "exports").resolve()
    assert export_dir.is_dir()


def test_copy_export_outputs(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.utils.export_local.get_data_directory",
        lambda: tmp_path,
    )
    source = tmp_path / "source.mp4"
    srt = tmp_path / "source.srt"
    source.write_bytes(b"video")
    srt.write_text("srt", encoding="utf-8")

    local_video, local_srt = copy_export_outputs(source, srt, str(tmp_path / "out"))

    assert local_video.exists()
    assert local_srt is not None and local_srt.exists()
    assert local_video.read_bytes() == b"video"
    assert local_srt.read_text(encoding="utf-8") == "srt"

"""BGM 转码工具测试。"""

from pathlib import Path
from unittest.mock import patch

from backend.utils.bgm_audio import bgm_media_type, ensure_browser_playable_bgm


def test_bgm_media_type_by_suffix():
    assert bgm_media_type(Path("bgm.m4a")) == "audio/mp4"
    assert bgm_media_type(Path("bgm.mp3")) == "audio/mpeg"
    assert bgm_media_type(Path("bgm.aiff")) == "audio/aiff"


def test_ensure_browser_playable_bgm_keeps_m4a(tmp_path):
    m4a = tmp_path / "bgm.m4a"
    m4a.write_bytes(b"fake")
    assert ensure_browser_playable_bgm(m4a) == m4a


@patch("backend.utils.bgm_audio.transcode_bgm_to_m4a")
def test_ensure_browser_playable_bgm_transcodes_aiff(mock_transcode, tmp_path):
    aiff = tmp_path / "bgm.aiff"
    aiff.write_bytes(b"fake")
    preview = tmp_path / "bgm.preview.m4a"

    def _fake_transcode(_source: Path, output: Path) -> bool:
        output.write_bytes(b"converted")
        return True

    mock_transcode.side_effect = _fake_transcode

    result = ensure_browser_playable_bgm(aiff)
    assert result == preview
    mock_transcode.assert_called_once()

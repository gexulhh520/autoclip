"""Tests for edit session TTS endpoint."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest


@pytest.fixture
def tts_session(tmp_path, monkeypatch):
    from backend.services.edit_session_service import EditSessionService

    project_id = "proj_tts_test"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda pid: project_dir if pid == project_id else tmp_path / pid,
    )

    service = EditSessionService(db=None)
    created = service.create_blank_session(project_id, name="TTS Test")
    session_id = created.id
    return service, project_id, session_id


def test_synthesize_speech_creates_sfx_asset(tts_session, monkeypatch):
    service, project_id, session_id = tts_session

    async def fake_synthesize(text, output_path, *, voice=None, rate="+0%"):
        output_path.write_bytes(b"fake-mp3")
        return voice or "zh-CN-XiaoxiaoNeural"

    monkeypatch.setattr(
        "backend.utils.edge_tts_service.synthesize_to_file",
        fake_synthesize,
    )

    def fake_transcode(source_path: Path, output_path: Path) -> bool:
        output_path.write_bytes(source_path.read_bytes())
        return True

    monkeypatch.setattr(
        "backend.services.edit_session_service.transcode_bgm_to_m4a",
        fake_transcode,
    )

    monkeypatch.setattr(
        "backend.services.edit_session_service.VideoProcessor.get_video_info",
        lambda _path: {"duration": 2.5},
    )

    session, asset_id, duration_sec, voice = asyncio.run(
        service.synthesize_speech(
            project_id,
            session_id,
            "你好，这是朗读测试。",
            voice="zh-CN-XiaoxiaoNeural",
        )
    )

    assert voice == "zh-CN-XiaoxiaoNeural"
    assert duration_sec == 2.5
    assert asset_id
    assert any(item.id == asset_id for item in session.audio_assets)
    assert session.audio_assets[-1].category == "sfx"


def test_synthesize_speech_rejects_empty_text(tts_session):
    service, project_id, session_id = tts_session
    with pytest.raises(ValueError, match="文本为空"):
        asyncio.run(service.synthesize_speech(project_id, session_id, "   "))


def test_resolve_edge_tts_voice_maps_deprecated_ids():
    from backend.utils.edge_tts_service import resolve_edge_tts_voice

    assert resolve_edge_tts_voice("zh-CN-XiaohanNeural") == "zh-CN-liaoning-XiaobeiNeural"
    assert resolve_edge_tts_voice("zh-CN-XiaomoNeural") == "zh-CN-shaanxi-XiaoniNeural"
    assert resolve_edge_tts_voice("zh-CN-YunfengNeural") == "zh-CN-YunxiaNeural"
    assert resolve_edge_tts_voice("zh-CN-XiaoxiaoNeural") == "zh-CN-XiaoxiaoNeural"
    assert resolve_edge_tts_voice("zh-HK-WanLungNeural") == "zh-HK-WanLungNeural"
    assert resolve_edge_tts_voice("zh-TW-HsiaoChenNeural") == "zh-TW-HsiaoChenNeural"
    assert resolve_edge_tts_voice("invalid-voice") == "zh-CN-XiaoxiaoNeural"


def test_preview_speech_returns_audio_bytes(tts_session, monkeypatch):
    service, project_id, session_id = tts_session

    async def fake_synthesize(text, output_path, *, voice=None, rate="+0%"):
        output_path.write_bytes(b"preview-mp3")
        return voice or "zh-CN-XiaoxiaoNeural"

    monkeypatch.setattr(
        "backend.utils.edge_tts_service.synthesize_to_file",
        fake_synthesize,
    )

    audio_bytes, media_type = asyncio.run(
        service.preview_speech(
            project_id,
            session_id,
            "预读测试",
            voice="zh-CN-XiaoxiaoNeural",
        )
    )

    assert audio_bytes == b"preview-mp3"
    assert media_type == "audio/mpeg"

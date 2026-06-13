"""P2 剪辑增强：上传元数据、批量 job、BGM ducking 等单元测试。"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.pipeline.edit_renderer import mix_bgm_track
from backend.schemas.edit_session import EditSessionAudioSettings
from backend.services.bilibili_service import build_upload_metadata
from backend.services.edit_export_job_service import EditExportJobService


def test_build_upload_metadata_parses_json_tags():
    record = SimpleNamespace(
        title="测试标题",
        description="简介",
        partition_id=36,
        tags=json.dumps(["剪辑", "金句"], ensure_ascii=False),
    )
    metadata = build_upload_metadata(record)
    assert metadata["title"] == "测试标题"
    assert metadata["partition_id"] == 36
    assert metadata["tags"] == ["剪辑", "金句"]


def test_edit_session_audio_settings_supports_bgm_duck():
    settings = EditSessionAudioSettings()
    assert settings.bgm_duck_enabled is True
    assert settings.bgm_duck_ratio == 8.0


def test_edit_export_job_service_batch_job_type():
    service = EditExportJobService()
    job = service.start_batch_export(
        project_id="p1",
        session_id="s1",
        session_payload={
            "schema_version": 1,
            "id": "s1",
            "project_id": "p1",
            "name": "test",
            "sequence": [],
            "export_settings": {
                "aspect": "9:16",
                "height": 1080,
                "fps": 30,
                "visual_filter": "none",
                "fit_mode": "cover",
            },
            "audio_settings": {
                "bgm_volume": 0.28,
                "fade_in_sec": 0.3,
                "fade_out_sec": 0.3,
                "use_source_video": True,
                "transition_duration_sec": 0.35,
            },
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
        burn_subtitles=False,
        export_srt=False,
        use_source_video=None,
    )
    assert job.job_type == "batch"
    stored = service.get_job(job.id)
    assert stored.job_type == "batch"


@patch("backend.pipeline.edit_renderer.subprocess.run")
@patch("backend.pipeline.edit_renderer._probe_duration", return_value=10.0)
def test_mix_bgm_track_uses_sidechain_when_duck_enabled(mock_probe, mock_run, tmp_path):
    def _fake_run(cmd, *args, **kwargs):
        Path(cmd[-1]).write_bytes(b"ok")
        return MagicMock(returncode=0)

    mock_run.side_effect = _fake_run
    video = tmp_path / "video.mp4"
    bgm = tmp_path / "bgm.mp3"
    output = tmp_path / "out.mp4"
    video.write_bytes(b"x")
    bgm.write_bytes(b"x")

    ok = mix_bgm_track(
        video,
        bgm,
        output,
        bgm_volume=0.3,
        fade_in_sec=0.2,
        fade_out_sec=0.2,
        duck_enabled=True,
        duck_ratio=10,
    )
    assert ok is True
    cmd = mock_run.call_args[0][0]
    filter_arg = cmd[cmd.index("-filter_complex") + 1]
    assert "sidechaincompress" in filter_arg


@patch("backend.pipeline.edit_renderer.subprocess.run")
@patch("backend.pipeline.edit_renderer._probe_duration", return_value=10.0)
def test_mix_bgm_track_plain_mix_when_duck_disabled(mock_probe, mock_run, tmp_path):
    def _fake_run(cmd, *args, **kwargs):
        Path(cmd[-1]).write_bytes(b"ok")
        return MagicMock(returncode=0)

    mock_run.side_effect = _fake_run
    video = tmp_path / "video.mp4"
    bgm = tmp_path / "bgm.mp3"
    output = tmp_path / "out.mp4"
    video.write_bytes(b"x")
    bgm.write_bytes(b"x")

    ok = mix_bgm_track(
        video,
        bgm,
        output,
        bgm_volume=0.3,
        fade_in_sec=0.2,
        fade_out_sec=0.2,
        duck_enabled=False,
    )
    assert ok is True
    cmd = mock_run.call_args[0][0]
    filter_arg = cmd[cmd.index("-filter_complex") + 1]
    assert "sidechaincompress" not in filter_arg

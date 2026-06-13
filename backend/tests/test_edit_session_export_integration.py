"""剪辑导出集成测试（需本机 FFmpeg）。"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.pipeline.edit_renderer import export_edit_session, preview_block_overlay
from backend.services.edit_session_service import EditSessionService
from backend.utils.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path


def _make_test_mp4(path: Path, duration: float = 2.5) -> None:
    ffmpeg = get_ffmpeg_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-f",
        "lavfi",
        "-i",
        f"color=c=#1a1a1a:s=720x1280:d={duration}",
        "-f",
        "lavfi",
        "-i",
        f"sine=f=440:d={duration}",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-t",
        str(duration),
        "-y",
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    assert result.returncode == 0, result.stderr[:500]
    assert path.exists() and path.stat().st_size > 0


def _probe_duration(path: Path) -> float:
    ffprobe = get_ffprobe_path()
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    assert result.returncode == 0
    return float(result.stdout.strip())


@pytest.fixture
def ffmpeg_available() -> None:
    if not shutil.which(get_ffmpeg_path()) and not Path(get_ffmpeg_path()).exists():
        pytest.skip("FFmpeg 不可用")


def test_export_session_produces_playable_mp4(tmp_path, monkeypatch, ffmpeg_available):
    project_id = "edit-export-integration"
    project_dir = tmp_path / "projects" / project_id
    clips_dir = project_dir / "output" / "clips"
    metadata_dir = project_dir / "metadata"
    clips_dir.mkdir(parents=True)
    metadata_dir.mkdir(parents=True)

    clip_a = clips_dir / "1_测试片段A.mp4"
    clip_b = clips_dir / "2_测试片段B.mp4"
    _make_test_mp4(clip_a, 2.0)
    _make_test_mp4(clip_b, 1.5)

    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "测试摘要A",
                    "content": ["测试金句A"],
                    "generated_title": "标题A",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:03,000",
                },
                {
                    "id": "2",
                    "outline": "测试摘要B",
                    "content": ["测试金句B"],
                    "generated_title": "标题B",
                    "start_time": "00:00:05,000",
                    "end_time": "00:00:06,500",
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (metadata_dir / "template_config.json").write_text(
        json.dumps(
            {
                "template_id": "golden_quote_cinema",
                "template_version": "1.3.0",
                "template_rules": {"subtitle_style": "quote_cinema"},
                "overlay": {"composer": "quote_cinema", "renderer": "ass_stack"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.pipeline.edit_renderer.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1", "2"])
    assert len(session.sequence) == 2
    assert session.sequence[0].trim.out_sec > 0

    preview = preview_block_overlay(session, session.sequence[0].id)
    assert preview["applicable"] is True
    assert preview["layout"] == "cinema"

    output, srt_path = export_edit_session(session, burn_subtitles=False, output_filename="集成测试导出")
    assert output.exists()
    assert srt_path is None
    duration = _probe_duration(output)
    assert duration >= 3.0, f"导出时长过短: {duration}s"

    output_srt, srt_file = export_edit_session(
        session,
        burn_subtitles=False,
        output_filename="集成测试SRT",
        export_srt=True,
    )
    assert output_srt.exists()
    assert srt_file is not None and srt_file.exists()
    srt_text = srt_file.read_text(encoding="utf-8")
    assert "测试金句A" in srt_text or "测试金句B" in srt_text

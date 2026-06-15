"""Compositor mux E2E — compositor MP4 + timeline audio → playable export (no Tauri UI)."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.pipeline.edit_renderer import mux_compositor_export
from backend.schemas.edit_session import EditSession
from backend.utils.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "compositor"


def _ffmpeg_available() -> bool:
    ffmpeg = get_ffmpeg_path()
    return bool(shutil.which(ffmpeg) or Path(ffmpeg).exists())


@pytest.fixture
def ffmpeg_available() -> None:
    if not _ffmpeg_available():
        pytest.skip("FFmpeg 不可用")


def _run_ffmpeg(cmd: list[str]) -> None:
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore"
    )
    assert result.returncode == 0, result.stderr[:500]


def _make_clip_mp4(path: Path, duration: float = 4.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg(
        [
            get_ffmpeg_path(),
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
    )


def _make_compositor_mp4(path: Path, duration: float = 4.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg(
        [
            get_ffmpeg_path(),
            "-f",
            "lavfi",
            "-i",
            f"color=c=#303038:s=608x1080:d={duration}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-t",
            str(duration),
            "-y",
            str(path),
        ]
    )


def _probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            get_ffprobe_path(),
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


def _extract_frame_rgba_hash(path: Path, time_sec: float = 1.0) -> str:
    result = subprocess.run(
        [
            get_ffmpeg_path(),
            "-ss",
            str(time_sec),
            "-i",
            str(path),
            "-vframes",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-",
        ],
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr[:300]
    return hashlib.sha256(result.stdout).hexdigest()


def _probe_has_audio(path: Path) -> bool:
    result = subprocess.run(
        [
            get_ffprobe_path(),
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    return result.returncode == 0 and "audio" in result.stdout


def _load_session(name: str) -> EditSession:
    data = json.loads((FIXTURES_ROOT / name).read_text(encoding="utf-8"))
    return EditSession.model_validate(data)


def test_compositor_mux_e2e_minimal_session(tmp_path, monkeypatch, ffmpeg_available):
    session = _load_session("session-minimal.json")
    project_dir = tmp_path / "projects" / session.project_id
    project_dir.mkdir(parents=True)
    _make_clip_mp4(project_dir / "a.mp4", duration=4.0)

    compositor_video = tmp_path / "compositor.mp4"
    _make_compositor_mp4(compositor_video, duration=4.0)

    monkeypatch.setattr(
        "backend.pipeline.edit_renderer.get_project_directory",
        lambda _project_id: project_dir,
    )

    mux_result = mux_compositor_export(
        session,
        compositor_video,
        export_srt=False,
        use_source_video=False,
    )

    assert mux_result.output_path.is_file()
    assert mux_result.srt_path is None
    assert mux_result.audio_mixed is True
    duration = _probe_duration(mux_result.output_path)
    assert 3.5 <= duration <= 4.5
    assert _probe_has_audio(mux_result.output_path)

    frame_hash = _extract_frame_rgba_hash(mux_result.output_path, time_sec=1.0)
    assert len(frame_hash) == 64
    assert frame_hash == _extract_frame_rgba_hash(mux_result.output_path, time_sec=1.0)


def test_compositor_mux_e2e_dissolve_session(tmp_path, monkeypatch, ffmpeg_available):
    session = _load_session("session-dissolve.json")
    project_dir = tmp_path / "projects" / session.project_id
    project_dir.mkdir(parents=True)
    _make_clip_mp4(project_dir / "a.mp4", duration=4.0)
    _make_clip_mp4(project_dir / "b.mp4", duration=3.0)

    compositor_video = tmp_path / "compositor_dissolve.mp4"
    _make_compositor_mp4(compositor_video, duration=6.65)

    monkeypatch.setattr(
        "backend.pipeline.edit_renderer.get_project_directory",
        lambda _project_id: project_dir,
    )

    mux_result = mux_compositor_export(
        session,
        compositor_video,
        export_srt=False,
        use_source_video=False,
    )

    duration = _probe_duration(mux_result.output_path)
    assert 6.0 <= duration <= 7.0
    assert mux_result.audio_mixed is True
    assert _probe_has_audio(mux_result.output_path)

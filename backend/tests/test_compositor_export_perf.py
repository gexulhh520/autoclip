"""Compositor 导出性能基线 — renderer / mux 分层计时（CI 跑缩小版）。"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from backend.utils.ffmpeg_utils import get_ffmpeg_path

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "compositor"
BASELINE_DIR = FIXTURES_ROOT / "baseline"


def _ffmpeg_available() -> bool:
    ffmpeg = get_ffmpeg_path()
    return bool(shutil.which(ffmpeg) or Path(ffmpeg).exists())


@pytest.fixture
def ffmpeg_available() -> None:
    if not _ffmpeg_available():
        pytest.skip("FFmpeg 不可用")


def _make_silent_mp4(path: Path, duration: float, width: int = 608, height: int = 1080) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        get_ffmpeg_path(),
        "-f",
        "lavfi",
        "-i",
        f"color=c=#303038:s={width}x{height}:d={duration}",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-y",
        str(path),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore"
    )
    assert result.returncode == 0, result.stderr[:300]


def test_mux_baseline_minimal_duration(tmp_path, ffmpeg_available):
    """CI 缩小版：4s silent compositor 视频生成耗时基线（无 Tauri）。"""
    duration = 4.0
    output = tmp_path / "bench_mux_input.mp4"
    started = time.perf_counter()
    _make_silent_mp4(output, duration=duration)
    wall_ms = int((time.perf_counter() - started) * 1000)

    assert output.stat().st_size > 1024
    assert wall_ms < 30_000, f"mux input generation too slow: {wall_ms}ms"

    report = {
        "component": "mux_input",
        "duration_sec": duration,
        "width": 608,
        "height": 1080,
        "wall_ms": wall_ms,
        "bytes": output.stat().st_size,
    }
    print(f"PERF_BASELINE {json.dumps(report, ensure_ascii=False)}")

    baseline_path = BASELINE_DIR / "export-perf-minimal.json"
    if baseline_path.is_file():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        ceiling = baseline.get("mux_input_wall_ms_ceiling", 15_000)
        assert wall_ms <= ceiling, f"regression: {wall_ms}ms > ceiling {ceiling}ms"


@pytest.mark.skipif(os.environ.get("COMPOSITOR_BENCHMARK") != "1", reason="set COMPOSITOR_BENCHMARK=1")
def test_mux_baseline_30s_optional(tmp_path, ffmpeg_available):
    """完整 30s 基线 — nightly / 本地 BENCHMARK_FULL=1。"""
    if os.environ.get("BENCHMARK_FULL") != "1":
        pytest.skip("set BENCHMARK_FULL=1 for 30s benchmark")

    duration = 30.0
    output = tmp_path / "bench_mux_30s.mp4"
    started = time.perf_counter()
    _make_silent_mp4(output, duration=duration)
    wall_ms = int((time.perf_counter() - started) * 1000)

    report = {
        "component": "mux_input_30s",
        "duration_sec": duration,
        "width": 608,
        "height": 1080,
        "wall_ms": wall_ms,
        "bytes": output.stat().st_size,
    }
    print(f"PERF_BASELINE {json.dumps(report, ensure_ascii=False)}")

    out_path = BASELINE_DIR / "export-perf-30s-latest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

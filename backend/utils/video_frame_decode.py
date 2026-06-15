"""Compositor 导出：FFmpeg 批量解码 clip 为 RGBA 帧（对齐 OpenCut 原生 decode，避免 WebView seek）。"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from backend.schemas.edit_session import EditBlock
from backend.utils.ffmpeg_utils import get_ffmpeg_path

logger = logging.getLogger(__name__)


def decode_block_frames_rgba(
    project_dir: Path,
    block: EditBlock,
    *,
    use_source_video: bool,
    fps: float,
    width: int,
    height: int,
) -> tuple[bytes, int, int, int]:
    """
    单次 FFmpeg 调用解码 block 时间窗内全部帧。

    Returns:
        (raw_rgba_bytes, frame_count, width, height)
    """
    from backend.pipeline.edit_renderer import _resolve_render_window

    if width <= 0 or height <= 0:
        raise ValueError("invalid canvas size")
    if fps <= 0:
        raise ValueError("invalid fps")

    input_video, trim_in, duration = _resolve_render_window(
        project_dir, block, use_source_video=use_source_video
    )
    frame_count = max(1, int(round(duration * fps)))
    vf = (
        f"fps={fps:.3f},scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"
    )
    cmd = [
        get_ffmpeg_path(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{trim_in:.6f}",
        "-i",
        str(input_video.resolve()),
        "-t",
        f"{duration:.6f}",
        "-vf",
        vf,
        "-frames:v",
        str(frame_count),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-",
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"FFmpeg 解码失败 ({block.id}): {stderr}")

    expected = frame_count * width * height * 4
    data = result.stdout
    if len(data) < expected:
        raise RuntimeError(
            f"FFmpeg 输出不足: 期望 {expected} bytes, 实际 {len(data)} ({block.id})"
        )
    return data[:expected], frame_count, width, height

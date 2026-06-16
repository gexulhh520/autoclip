"""BGM 转码与预览流 MIME 解析。"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from backend.utils.ffmpeg_utils import get_ffmpeg_path

logger = logging.getLogger(__name__)

# HTML5 <audio> 在各浏览器中普遍可播的格式
_BROWSER_FRIENDLY_SUFFIXES = {".m4a", ".mp3", ".aac", ".wav", ".ogg"}

BGM_MEDIA_TYPES: dict[str, str] = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".mp4": "audio/mp4",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
}


def bgm_media_type(path: Path) -> str:
    return BGM_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def transcode_bgm_to_m4a(source: Path, output: Path) -> bool:
    """将任意 ffmpeg 可读音频/视频音轨转为 AAC m4a，供浏览器预览。"""
    if not source.exists():
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        get_ffmpeg_path(),
        "-y",
        "-i",
        str(source.resolve()),
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(output.resolve()),
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    if result.returncode != 0:
        logger.warning(
            "BGM 转码失败 (%s): %s",
            source.name,
            (result.stderr or result.stdout or "")[:400],
        )
        return False
    return output.exists() and output.stat().st_size > 0


def ensure_browser_playable_bgm(bgm_path: Path) -> Path:
    """预览流：非浏览器友好格式时转码为 sidecar bgm.preview.m4a。"""
    if bgm_path.suffix.lower() in _BROWSER_FRIENDLY_SUFFIXES:
        return bgm_path
    preview = bgm_path.parent / "bgm.preview.m4a"
    try:
        source_mtime = bgm_path.stat().st_mtime
        if preview.exists() and preview.stat().st_mtime >= source_mtime:
            return preview
    except OSError:
        return bgm_path
    if transcode_bgm_to_m4a(bgm_path, preview):
        return preview
    return bgm_path

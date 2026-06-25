"""从短视频/平台链接下载视频并提取音频（yt-dlp）。"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import yt_dlp

from backend.utils.link_url_utils import (
    detect_link_platform,
    get_platform_label,
    supported_platform_labels,
)

logger = logging.getLogger(__name__)

SUPPORTED_PLATFORM_IDS = ("douyin", "bilibili", "youtube")


class UnsupportedLinkPlatformError(ValueError):
    pass


class LinkDownloadError(RuntimeError):
    pass


@contextmanager
def _sanitized_yt_env():
    original_env = os.environ.copy()
    try:
        for key in list(os.environ.keys()):
            upper_key = key.upper()
            if (
                upper_key.startswith("YT_DLP")
                or upper_key.startswith("YTDL")
                or upper_key.startswith("YOUTUBE_DL")
                or upper_key.startswith("YOUTUBEDL")
            ):
                os.environ.pop(key, None)
        yield
    finally:
        os.environ.clear()
        os.environ.update(original_env)


def _base_ytdl_opts(output_template: str) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "ignoreconfig": True,
        "noplaylist": True,
        "config_locations": [],
        "cachedir": False,
        "format": "bestvideo+bestaudio/best",
        "merge_output_format": "mp4",
        "outtmpl": output_template,
    }


def _platform_ytdl_opts(platform_id: str, output_template: str) -> dict:
    opts = _base_ytdl_opts(output_template)
    if platform_id == "douyin":
        opts.setdefault("http_headers", {})["User-Agent"] = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    return opts


def _resolve_downloaded_path(info: dict, output_dir: Path) -> Path:
    if not info:
        raise LinkDownloadError("未获取到下载信息")

    candidates: list[Path] = []
    for key in ("filepath", "_filename"):
        raw = info.get(key)
        if raw:
            candidates.append(Path(raw))

    requested = info.get("requested_downloads") or []
    for item in requested:
        raw = item.get("filepath")
        if raw:
            candidates.append(Path(raw))

    merge_path = info.get("__files_to_merge")
    if merge_path:
        stem = Path(merge_path[0]).stem if merge_path else "video"
        candidates.append(output_dir / f"{stem}.mp4")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    for path in sorted(output_dir.glob("video.*")):
        if path.is_file() and path.stat().st_size > 0:
            return path

    raise LinkDownloadError("下载完成但未找到视频文件")


def _resolve_platform(url: str, platform_id: Optional[str]) -> str:
    explicit = (platform_id or "").strip().lower()
    if explicit:
        if explicit not in SUPPORTED_PLATFORM_IDS:
            labels = "、".join(supported_platform_labels())
            raise UnsupportedLinkPlatformError(f"不支持的平台: {platform_id}，当前支持：{labels}")
        return explicit
    detected = detect_link_platform(url)
    if not detected:
        labels = "、".join(supported_platform_labels())
        raise UnsupportedLinkPlatformError(f"暂不支持该链接，当前支持：{labels}")
    return detected


def download_link_video(url: str, output_dir: Path, platform_id: Optional[str] = None) -> tuple[Path, str]:
    """
    使用 yt-dlp 下载链接中的视频（mp4），返回本地路径与展示标题。
    调用方负责在提取音频后删除视频文件。
    """
    normalized_url = (url or "").strip()
    if not normalized_url:
        raise ValueError("链接不能为空")

    resolved_platform = _resolve_platform(normalized_url, platform_id)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str((output_dir / "video.%(ext)s").resolve())

    ydl_opts = _platform_ytdl_opts(resolved_platform, output_template)

    def _run() -> tuple[Path, str]:
        with _sanitized_yt_env():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(normalized_url, download=True)
                if not info:
                    raise LinkDownloadError("无法解析链接内容")
                video_path = _resolve_downloaded_path(info, output_dir)
                title = (info.get("title") or info.get("description") or "链接音频").strip()
                if not title:
                    title = "链接音频"
                return video_path, title[:120]

    try:
        return _run()
    except UnsupportedLinkPlatformError:
        raise
    except Exception as exc:
        logger.exception("链接下载失败 (%s): %s", resolved_platform, normalized_url)
        label = get_platform_label(resolved_platform)
        raise LinkDownloadError(f"{label}链接下载失败：{exc}") from exc

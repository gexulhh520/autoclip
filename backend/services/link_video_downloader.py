"""将 B 站 / YouTube 链接下载到指定源目录。"""
from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Optional

from backend.core.config import get_data_directory
from backend.utils.bilibili_downloader import download_bilibili_video, get_bilibili_video_info
from backend.utils.link_url_utils import LinkPlatform

logger = logging.getLogger(__name__)


async def fetch_link_title(url: str, platform: LinkPlatform, browser: Optional[str] = None) -> str:
    if platform == "bilibili":
        info = await get_bilibili_video_info(url, browser=browser)
        return info.title or url
    import yt_dlp

    from backend.api.v1.youtube import _apply_yt_client, _base_ytdl_opts, _extract_info

    ydl_opts = _apply_yt_client(_base_ytdl_opts())
    loop = asyncio.get_event_loop()
    info = await loop.run_in_executor(None, _extract_info, url, ydl_opts, browser)
    return str(info.get("title") or url)


async def _ensure_subtitle(video_path: Path, subtitle_path: Optional[str], title: str) -> Path:
    if subtitle_path:
        candidate = Path(subtitle_path)
        if candidate.is_file():
            return candidate

    from backend.utils.speech_recognizer import SpeechRecognitionError, generate_subtitle_for_video

    model = "base"
    if title and any(keyword in title for keyword in ("教程", "教学", "知识", "科普")):
        model = "small"
    generated = generate_subtitle_for_video(video_path, language="auto", model=model)
    return Path(generated)


async def download_link_to_source(
    *,
    url: str,
    platform: LinkPlatform,
    video_dest: Path,
    srt_dest: Path,
    browser: Optional[str] = None,
) -> None:
    """下载单个链接到多源目录下的 input.mp4 / input.srt。"""
    video_dest.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = get_data_directory() / "temp" / "link_batch"
    temp_dir.mkdir(parents=True, exist_ok=True)

    if platform == "bilibili":
        result = await download_bilibili_video(url, download_dir=temp_dir, browser=browser)
        video_path = Path(result.get("video_path") or "")
        subtitle_path = result.get("subtitle_path") or ""
        if not video_path.is_file():
            raise RuntimeError("B 站视频下载失败")
        title = url
        try:
            title = (await get_bilibili_video_info(url, browser=browser)).title
        except Exception:
            pass
    else:
        import yt_dlp

        from backend.api.v1.youtube import (
            _apply_yt_client,
            _base_ytdl_opts,
            _download_url,
            _try_youtube_subtitle_strategies,
        )

        ydl_opts = _apply_yt_client(
            {
                "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitleslangs": ["en", "zh-Hans", "zh", "en-US", "auto"],
                "subtitlesformat": "srt",
                "outtmpl": str(temp_dir / "%(title)s.%(ext)s"),
                **_base_ytdl_opts(),
                "no_warnings": False,
            }
        )
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _download_url, url, ydl_opts, browser)
        video_files = sorted(temp_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not video_files:
            raise RuntimeError("YouTube 视频下载失败")
        video_path = video_files[0]
        subtitle_files = sorted(temp_dir.glob("*.srt"), key=lambda p: p.stat().st_mtime, reverse=True)
        subtitle_path = str(subtitle_files[0]) if subtitle_files else ""
        title = video_path.stem
        if not subtitle_path:
            try:
                resolved = await _try_youtube_subtitle_strategies(url, temp_dir, browser)
                subtitle_path = resolved or ""
            except Exception as exc:
                logger.warning("YouTube 备用字幕获取失败: %s", exc)

    resolved_srt = await _ensure_subtitle(video_path, subtitle_path or None, title)
    shutil.move(str(video_path), str(video_dest))
    shutil.copy2(str(resolved_srt), str(srt_dest))
    if resolved_srt.parent != srt_dest.parent and resolved_srt.is_file():
        resolved_srt.unlink(missing_ok=True)

    for pattern in ("*.mp4", "*.srt", "*.m4a", "*.webm"):
        for leftover in temp_dir.glob(pattern):
            try:
                leftover.unlink(missing_ok=True)
            except OSError:
                pass

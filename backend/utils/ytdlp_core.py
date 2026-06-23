"""yt-dlp 公共封装：环境隔离、解析、搜索、下载。"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import contextmanager
from typing import Any, Callable, Dict, List, Optional

import yt_dlp

logger = logging.getLogger(__name__)

PLATFORM_SEARCH_KEYS: Dict[str, str] = {
    "youtube": "ytsearch",
    "bilibili": "bilisearch",
}


@contextmanager
def sanitized_yt_env():
    original_env = os.environ.copy()
    try:
        for key in list(os.environ.keys()):
            upper_key = key.upper()
            if upper_key.startswith(("YT_DLP", "YTDL", "YOUTUBE_DL", "YOUTUBEDL")):
                os.environ.pop(key, None)
        yield
    finally:
        os.environ.clear()
        os.environ.update(original_env)


def base_ytdl_opts(**overrides: Any) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "ignoreconfig": True,
        "noplaylist": True,
        "config_locations": [],
        "cachedir": False,
    }
    opts.update(overrides)
    return opts


def apply_youtube_client(ydl_opts: dict, client: Optional[str] = None) -> dict:
    opts = dict(ydl_opts)
    client_name = (client or os.getenv("AUTOCLIP_YT_CLIENT", "")).strip().lower()
    if client_name in {"android", "ios", "tv"}:
        opts.setdefault("extractor_args", {}).setdefault("youtube", {}).setdefault(
            "player_client", [],
        ).append(client_name)
    return opts


def _is_browser_cookie_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "cookie" in msg and (
        "could not copy" in msg or "failed to load" in msg or "permission" in msg
    )


def _is_network_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "ssl",
            "unexpected_eof",
            "connection reset",
            "connection refused",
            "timed out",
            "network is unreachable",
            "unable to download",
        )
    )


def _youtube_player_client_configured(ydl_opts: dict) -> bool:
    clients = (
        ydl_opts.get("extractor_args", {})
        .get("youtube", {})
        .get("player_client", [])
    )
    return bool(clients)


def _with_youtube_player_client(ydl_opts: dict, client: str) -> dict:
    opts = dict(ydl_opts)
    player_clients = opts.setdefault("extractor_args", {}).setdefault("youtube", {}).setdefault(
        "player_client", [],
    )
    if client not in player_clients:
        player_clients.append(client)
    return opts


def run_ytdl_with_fallbacks(
    ydl_opts: dict,
    browser: Optional[str],
    action: str,
    runner: Callable[[dict, bool], Any],
) -> Any:
    opts = dict(ydl_opts)
    use_browser = bool(browser)
    network_retried = False

    while True:
        try:
            return runner(opts, use_browser)
        except Exception as exc:
            if use_browser and _is_browser_cookie_error(exc):
                logger.warning(
                    "无法读取 %s 浏览器 Cookie，将无 Cookie 重试: %s",
                    browser,
                    exc,
                )
                use_browser = False
                continue
            if (
                not network_retried
                and _is_network_error(exc)
                and not _youtube_player_client_configured(opts)
            ):
                logger.warning(
                    "YouTube %s 网络/SSL 错误，将使用 android client 重试: %s",
                    action,
                    exc,
                )
                opts = _with_youtube_player_client(opts, "android")
                network_retried = True
                continue
            raise


def extract_info(
    url: str,
    ydl_opts: Optional[dict] = None,
    browser: Optional[str] = None,
) -> dict:
    opts = base_ytdl_opts(**(ydl_opts or {}))

    def _run(run_opts: dict, use_browser: bool):
        run_opts = dict(run_opts)
        if use_browser and browser:
            run_opts["cookiesfrombrowser"] = (browser.lower(),)
        else:
            run_opts.pop("cookiesfrombrowser", None)
        with sanitized_yt_env():
            with yt_dlp.YoutubeDL(run_opts) as ydl:
                return ydl.extract_info(url, download=False)

    return run_ytdl_with_fallbacks(opts, browser, "解析", _run)


def download_url(
    url: str,
    ydl_opts: dict,
    browser: Optional[str] = None,
) -> int:
    def _run(run_opts: dict, use_browser: bool):
        run_opts = dict(run_opts)
        if use_browser and browser:
            run_opts["cookiesfrombrowser"] = (browser.lower(),)
        else:
            run_opts.pop("cookiesfrombrowser", None)
        with sanitized_yt_env():
            with yt_dlp.YoutubeDL(run_opts) as ydl:
                return ydl.download([url])

    return run_ytdl_with_fallbacks(ydl_opts, browser, "下载", _run)


def build_search_url(platform: str, query: str, limit: int) -> str:
    prefix = PLATFORM_SEARCH_KEYS.get(platform)
    if not prefix:
        raise ValueError(f"不支持的平台搜索: {platform}")
    safe_limit = max(1, min(int(limit), 50))
    return f"{prefix}{safe_limit}:{query.strip()}"


def search_platform(
    platform: str,
    query: str,
    limit: int = 20,
    browser: Optional[str] = None,
) -> List[dict]:
    search_url = build_search_url(platform, query, limit)
    info = extract_info(
        search_url,
        {
            "extract_flat": "in_playlist",
            "skip_download": True,
        },
        browser=browser,
    )
    entries = info.get("entries") or []
    results: List[dict] = []
    for entry in entries:
        if not entry:
            continue
        normalized = normalize_search_entry(platform, entry)
        if normalized:
            results.append(normalized)
    return results


def normalize_search_entry(platform: str, entry: dict) -> Optional[dict]:
    external_id = str(entry.get("id") or "").strip()
    title = str(entry.get("title") or external_id or "未命名").strip()
    url = str(entry.get("url") or entry.get("webpage_url") or "").strip()
    if not url and external_id:
        if platform == "youtube":
            url = f"https://www.youtube.com/watch?v={external_id}"
        elif platform == "bilibili":
            url = f"https://www.bilibili.com/video/{external_id}"
    if not url:
        return None
    duration = entry.get("duration")
    if duration is None:
        duration = entry.get("duration_string")
    try:
        duration_sec = int(duration) if duration is not None else None
    except (TypeError, ValueError):
        duration_sec = None
    return {
        "platform": platform,
        "external_id": external_id or None,
        "title": title,
        "url": url,
        "thumbnail": entry.get("thumbnail") or entry.get("thumbnails", [{}])[0].get("url"),
        "duration_sec": duration_sec,
        "uploader": entry.get("uploader") or entry.get("channel"),
        "view_count": entry.get("view_count"),
        "upload_date": entry.get("upload_date"),
    }


def log_ytdlp_version() -> None:
    try:
        logger.info("yt-dlp=%s, py=%s", yt_dlp.version.__version__, sys.executable)
    except Exception:
        pass

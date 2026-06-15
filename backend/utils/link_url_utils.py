"""B 站 / YouTube 链接识别与规范化。"""
from __future__ import annotations

import re
from typing import List, Literal, Optional, Tuple

LinkPlatform = Literal["bilibili", "youtube"]

_BILIBILI_PATTERNS = (
    re.compile(r"^https?://(www\.)?bilibili\.com/video/[Bb][Vv][0-9A-Za-z]+", re.I),
    re.compile(r"^https?://bilibili\.com/video/[Bb][Vv][0-9A-Za-z]+", re.I),
    re.compile(r"^https?://b23\.tv/[0-9A-Za-z]+", re.I),
    re.compile(r"^https?://(www\.)?bilibili\.com/video/av\d+", re.I),
)

_YOUTUBE_PATTERNS = (
    re.compile(r"^https?://(www\.)?youtube\.com/watch\?v=[\w-]+", re.I),
    re.compile(r"^https?://youtu\.be/[\w-]+", re.I),
    re.compile(r"^https?://(www\.)?youtube\.com/embed/[\w-]+", re.I),
    re.compile(r"^https?://(www\.)?youtube\.com/v/[\w-]+", re.I),
)


def detect_link_platform(url: str) -> Optional[LinkPlatform]:
    text = url.strip()
    if not text:
        return None
    if any(pattern.search(text) for pattern in _BILIBILI_PATTERNS):
        return "bilibili"
    if any(pattern.search(text) for pattern in _YOUTUBE_PATTERNS):
        return "youtube"
    return None


def parse_link_urls(raw: str | List[str], *, max_count: int = 20) -> List[str]:
    if isinstance(raw, str):
        lines = raw.replace("\r\n", "\n").split("\n")
    else:
        lines = list(raw)
    urls: List[str] = []
    seen: set[str] = set()
    for line in lines:
        candidate = line.strip()
        if not candidate:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        urls.append(candidate)
    if not urls:
        raise ValueError("请至少输入一个视频链接")
    if len(urls) > max_count:
        raise ValueError(f"单次最多 {max_count} 个链接")
    return urls


def validate_link_urls(urls: List[str]) -> List[Tuple[str, LinkPlatform]]:
    validated: List[Tuple[str, LinkPlatform]] = []
    for url in urls:
        platform = detect_link_platform(url)
        if platform is None:
            raise ValueError(f"无效的视频链接: {url}")
        validated.append((url, platform))
    return validated

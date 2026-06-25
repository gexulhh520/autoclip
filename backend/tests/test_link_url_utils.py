"""Tests for link URL parsing."""

import pytest

from backend.utils.link_url_utils import detect_link_platform, parse_link_urls, validate_link_urls


def test_detect_bilibili_and_youtube():
    assert detect_link_platform("https://www.bilibili.com/video/BV1xx411c7mu") == "bilibili"
    assert detect_link_platform("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "youtube"
    assert detect_link_platform("https://v.douyin.com/RBZnW4-92WE/") == "douyin"
    assert detect_link_platform("https://example.com/video") is None


def test_parse_and_validate_multiple_urls():
    raw = "https://www.bilibili.com/video/BV1xx411c7mu\nhttps://youtu.be/abc123\n"
    urls = parse_link_urls(raw)
    assert len(urls) == 2
    validated = validate_link_urls(urls)
    assert validated[0][1] == "bilibili"
    assert validated[1][1] == "youtube"


def test_parse_link_urls_rejects_empty():
    with pytest.raises(ValueError):
        parse_link_urls("\n  \n")


def test_parse_link_urls_max_count():
    urls = [f"https://www.bilibili.com/video/BV{100000 + i}" for i in range(21)]
    with pytest.raises(ValueError):
        parse_link_urls(urls, max_count=20)

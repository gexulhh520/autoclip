from backend.utils.link_audio_downloader import (
    SUPPORTED_PLATFORM_IDS,
    _resolve_platform,
)
from backend.utils.link_url_utils import detect_link_platform, get_platform_label


def test_detect_link_platform_douyin():
    assert detect_link_platform("https://v.douyin.com/RBZnW4-92WE/") == "douyin"
    assert detect_link_platform("https://www.douyin.com/video/123") == "douyin"
    assert detect_link_platform("https://www.iesdouyin.com/share/video/123") == "douyin"


def test_detect_link_platform_youtube_and_bilibili():
    assert detect_link_platform("https://www.youtube.com/watch?v=abc") == "youtube"
    assert detect_link_platform("https://youtu.be/abc123") == "youtube"
    assert detect_link_platform("https://www.bilibili.com/video/BV1xx411c7mu") == "bilibili"


def test_detect_link_platform_unsupported():
    assert detect_link_platform("https://example.com/video") is None
    assert detect_link_platform("") is None


def test_get_platform_label():
    assert get_platform_label("douyin") == "抖音"
    assert get_platform_label("youtube") == "YouTube"
    assert get_platform_label("bilibili") == "Bilibili"


def test_resolve_platform_explicit():
    assert _resolve_platform("https://example.com/x", "youtube") == "youtube"


def test_supported_platform_ids():
    assert set(SUPPORTED_PLATFORM_IDS) == {"douyin", "bilibili", "youtube"}

from backend.utils.link_audio_downloader import (
    detect_link_platform,
    get_platform_label,
)


def test_detect_link_platform_douyin():
    assert detect_link_platform("https://v.douyin.com/RBZnW4-92WE/") == "douyin"
    assert detect_link_platform("https://www.douyin.com/video/123") == "douyin"
    assert detect_link_platform("https://www.iesdouyin.com/share/video/123") == "douyin"


def test_detect_link_platform_unsupported():
    assert detect_link_platform("https://www.youtube.com/watch?v=abc") is None
    assert detect_link_platform("") is None


def test_get_platform_label():
    assert get_platform_label("douyin") == "抖音"

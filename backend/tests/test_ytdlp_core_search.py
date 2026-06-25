from unittest.mock import patch

from backend.utils import ytdlp_core


def test_needs_bilibili_title_probe_numeric_fallback():
    item = {
        "external_id": "115314402531198",
        "title": "115314402531198",
    }
    assert ytdlp_core.needs_bilibili_title_probe(item) is True


def test_needs_bilibili_title_probe_real_title():
    item = {
        "external_id": "BV1xx411c7mD",
        "title": "真实视频标题",
    }
    assert ytdlp_core.needs_bilibili_title_probe(item) is False


def test_probe_bilibili_search_item_merges_metadata():
    item = {
        "platform": "bilibili",
        "external_id": "115314402531198",
        "title": "115314402531198",
        "url": "http://www.bilibili.com/video/av115314402531198",
        "thumbnail": None,
        "duration_sec": None,
        "uploader": None,
        "view_count": None,
        "upload_date": None,
    }
    probed = {
        "id": "BV1test123",
        "title": "猫咪日常",
        "webpage_url": "https://www.bilibili.com/video/BV1test123",
        "thumbnail": "https://example.com/thumb.jpg",
        "duration": 95,
        "uploader": "测试UP",
        "view_count": 12345,
        "upload_date": "20250101",
    }
    with patch.object(ytdlp_core, "extract_info", return_value=probed):
        merged = ytdlp_core.probe_bilibili_search_item(item)

    assert merged["title"] == "猫咪日常"
    assert merged["external_id"] == "BV1test123"
    assert merged["url"] == "https://www.bilibili.com/video/BV1test123"
    assert merged["thumbnail"] == "https://example.com/thumb.jpg"
    assert merged["duration_sec"] == 95
    assert merged["uploader"] == "测试UP"
    assert merged["view_count"] == 12345
    assert merged["upload_date"] == "20250101"


def test_enrich_bilibili_search_results_skips_real_titles():
    results = [
        {
            "external_id": "BV1ok",
            "title": "已有标题",
            "url": "https://www.bilibili.com/video/BV1ok",
        },
        {
            "external_id": "115314402531198",
            "title": "115314402531198",
            "url": "http://www.bilibili.com/video/av115314402531198",
        },
    ]

    def fake_probe(item, browser=None):
        assert item["title"] == "115314402531198"
        return {**item, "title": "补全后的标题"}

    with patch.object(ytdlp_core, "probe_bilibili_search_item", side_effect=fake_probe) as probe:
        enriched = ytdlp_core.enrich_bilibili_search_results(results)

    assert enriched[0]["title"] == "已有标题"
    assert enriched[1]["title"] == "补全后的标题"
    assert probe.call_count == 1

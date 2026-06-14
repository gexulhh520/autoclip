"""overlay 烧录策略：切片导出 vs 下载。"""

from backend.pipeline.overlay_pipeline import (
    COMPOSER_QUOTE_CINEMA,
    should_burn_overlay_on_clip_export,
    should_burn_overlay_on_download,
)


def test_golden_quote_does_not_burn_on_clip_export():
    settings = {
        "template_id": "golden_quote_cinema",
        "template_rules": {
            "subtitle_style": "quote_cinema",
            "overlay": {"composer": "quote_cinema", "renderer": "ass_stack"},
        },
    }
    assert should_burn_overlay_on_clip_export(settings) is False
    assert should_burn_overlay_on_download(settings) is True


def test_explicit_burn_on_clip_export_override():
    settings = {
        "template_rules": {
            "subtitle_style": "quote_cinema",
            "overlay": {"composer": COMPOSER_QUOTE_CINEMA, "renderer": "ass_stack"},
            "burn_overlay_on_clip_export": True,
        }
    }
    assert should_burn_overlay_on_clip_export(settings) is True


def test_no_overlay_composer_burns_on_export_by_default():
    settings = {"template_rules": {"subtitle_style": "default"}}
    assert should_burn_overlay_on_clip_export(settings) is True
    assert should_burn_overlay_on_download(settings) is False

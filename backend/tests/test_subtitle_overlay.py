from pathlib import Path

from backend.pipeline.subtitle_styles import resolve_quote_overlay_config
from backend.pipeline.template_engine import get_template_engine
from backend.utils.video_processor import VideoProcessor


def test_quote_overlay_config_comes_from_template():
    settings = get_template_engine().resolve_processing_settings("golden_quote_cinema")
    config = resolve_quote_overlay_config(settings)

    assert config["layout"] == "cinema"
    assert config["base_font_size"] == 32
    assert config["max_headline_chars"] == 12
    assert config["headline_color"] == "#E8C872"
    assert config["max_body_points"] == 2
    assert config["alignment"] == "bottom-left"
    assert config["color_preset"] == "golden_cinema"


def test_color_preset_can_be_overridden():
    settings = get_template_engine().resolve_processing_settings("golden_quote_cinema")
    rules = settings.setdefault("template_rules", {})
    overlay = dict(rules.get("quote_overlay") or {})
    overlay["color_preset"] = "mono_white"
    overlay["headline_color"] = "#FF0000"
    rules["quote_overlay"] = overlay
    config = resolve_quote_overlay_config(settings)
    assert config["headline_color"] == "#FF0000"
    assert config["body_color"] == "#D8D8D8"


def test_drawtext_filter_uses_fontfile_and_utf8_textfile(tmp_path):
    font_path = tmp_path / "NotoSansCJKsc-Regular.otf"
    font_path.write_bytes(b"fake-font-for-filter-build-test")
    output_path = tmp_path / "clip.mp4"

    vf = VideoProcessor._build_drawtext_filter(
        "这是一个很长的中文金句标题用于测试自动换行",
        output_path,
        {
            "font_file": str(font_path),
            "font_size": 48,
            "font_color": "#FFE066",
            "box_color": "#00000099",
            "max_chars_per_line": 8,
        },
    )

    assert vf is not None
    assert "drawtext=" in vf
    assert "fontfile=" in vf
    assert "textfile=" in vf
    assert "fontsize=48" in vf
    assert "fontcolor=0xFFE066" in vf
    assert "boxcolor=0x000000@0.600" in vf

    text_file = output_path.with_suffix(output_path.suffix + ".overlay.txt")
    content = text_file.read_text(encoding="utf-8")
    assert "\n" in content
    assert "金句" in content


def test_drawtext_filter_skips_overlay_without_font(monkeypatch, tmp_path):
    monkeypatch.delenv("AUTOCLIP_SUBTITLE_FONT_PATH", raising=False)
    monkeypatch.setattr(VideoProcessor, "_default_cjk_font_candidates", staticmethod(lambda: []))

    vf = VideoProcessor._build_drawtext_filter("中文标题", tmp_path / "clip.mp4", {})

    assert vf is None

"""基因模板字幕/叠加样式解析。"""
from __future__ import annotations

from typing import Any, Dict, Optional

DEFAULT_SUBTITLE_STYLE = "default"
QUOTE_HIGHLIGHT_STYLE = "quote_highlight"
QUOTE_CINEMA_STYLE = "quote_cinema"

DEFAULT_QUOTE_OVERLAY_CONFIG: Dict[str, Any] = {
    "font_size": 42,
    "font_color": "white",
    "border_color": "black",
    "border_width": 3,
    "box": True,
    "box_color": "black@0.50",
    "box_border_width": 18,
    "margin_bottom": 80,
    "line_spacing": 8,
    "max_chars_per_line": 18,
}

# quote_cinema 排版默认值；各基因模板可在 rules.quote_overlay 中覆盖
DEFAULT_QUOTE_CINEMA_CONFIG: Dict[str, Any] = {
    "layout": "cinema",
    "base_font_size": 32,
    "margin_left": 44,
    "margin_bottom": 72,
    "margin_left_ratio": 0.055,
    "margin_bottom_ratio": 0.11,
    "max_headline_chars": 12,
    "max_body_chars": 24,
    "max_body_points": 2,
    "headline_color": "#E8C872",
    "body_color": "#FFFFFF",
    "headline_size_scale": 1.0,
    "body_size_scales": [0.72, 0.65],
    "line_height_factor": 1.35,
    "min_font_size": 16,
    "headline_bold": True,
    "headline_outline": 1,
    "headline_shadow": 2,
    "body_shadow": 1,
    "show_quote_mark": False,
    "show_emphasis_line": False,
    "show_tagline_en": False,
    "quote_mark_size_scale": 0.55,
    "emphasis_size_scale": 0.82,
    "caps_label": "THE MOMENT",
    "content_priority": ["content", "outline", "recommend_reason"],
    "alignment": "bottom-left",
    "margin_right": 44,
    "margin_right_ratio": 0.055,
    "color_preset": "golden_cinema",
}

# 模板可选配色方案；显式 headline_color / body_color 会覆盖 preset
QUOTE_CINEMA_COLOR_PRESETS: Dict[str, Dict[str, str]] = {
    "golden_cinema": {
        "headline_color": "#E8C872",
        "body_color": "#FFFFFF",
    },
    "mono_white": {
        "headline_color": "#FFFFFF",
        "body_color": "#D8D8D8",
    },
    "calm_ink": {
        "headline_color": "#ECEAE6",
        "body_color": "#A6A29B",
    },
    "accent_blue": {
        "headline_color": "#5A8BFF",
        "body_color": "#FFFFFF",
    },
}

CINEMA_ALIGNMENTS = frozenset({"bottom-left", "bottom-center", "bottom-right"})


def _apply_color_preset(config: Dict[str, Any], explicit_keys: set) -> None:
    preset_name = str(config.get("color_preset") or "").strip()
    if not preset_name or preset_name not in QUOTE_CINEMA_COLOR_PRESETS:
        return
    for key, value in QUOTE_CINEMA_COLOR_PRESETS[preset_name].items():
        if key not in explicit_keys:
            config[key] = value


def resolve_subtitle_style(settings: Optional[Dict[str, Any]] = None) -> str:
    settings = settings or {}
    rules = settings.get("template_rules") or {}
    style = rules.get("subtitle_style") or DEFAULT_SUBTITLE_STYLE
    return str(style)


def resolve_quote_overlay_config(settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """返回金句叠加的排版配置（quote_highlight / quote_cinema 共用）。"""
    settings = settings or {}
    rules = settings.get("template_rules") or {}
    style = rules.get("subtitle_style") or DEFAULT_SUBTITLE_STYLE
    base_defaults = (
        dict(DEFAULT_QUOTE_CINEMA_CONFIG)
        if style == QUOTE_CINEMA_STYLE
        else dict(DEFAULT_QUOTE_OVERLAY_CONFIG)
    )
    config = dict(base_defaults)

    overlay_rules = rules.get("quote_overlay") or rules.get("subtitle_overlay") or {}
    if isinstance(overlay_rules, dict):
        explicit_color_keys = {
            k for k in ("headline_color", "body_color") if k in overlay_rules
        }
        config.update({k: v for k, v in overlay_rules.items() if v is not None})
        _apply_color_preset(config, explicit_color_keys)

    alignment = str(config.get("alignment") or "bottom-left")
    if alignment not in CINEMA_ALIGNMENTS:
        config["alignment"] = "bottom-left"

    flat_key_map = {
        "subtitle_font_size": "font_size",
        "subtitle_font_color": "font_color",
        "subtitle_border_color": "border_color",
        "subtitle_border_width": "border_width",
        "subtitle_margin_bottom": "margin_bottom",
        "subtitle_max_chars_per_line": "max_chars_per_line",
        "subtitle_font_file": "font_file",
    }
    for source_key, target_key in flat_key_map.items():
        if rules.get(source_key) is not None:
            config[target_key] = rules[source_key]
    return config


def should_apply_quote_overlay(style: str) -> bool:
    return style in {QUOTE_HIGHLIGHT_STYLE, QUOTE_CINEMA_STYLE}


def should_apply_cinema_overlay(style: str) -> bool:
    return style == QUOTE_CINEMA_STYLE

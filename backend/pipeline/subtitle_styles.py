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

DEFAULT_QUOTE_CINEMA_CONFIG: Dict[str, Any] = {
    "layout": "cinema",
    "base_font_size": 32,
    "margin_left": 44,
    "margin_bottom": 72,
    "max_headline_chars": 12,
    "max_body_chars": 24,
    "show_tagline_en": False,
    "caps_label": "THE MOMENT",
}


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

    # 新配置入口：rules.quote_overlay = {font_size, font_color, ...}
    overlay_rules = rules.get("quote_overlay") or rules.get("subtitle_overlay") or {}
    if isinstance(overlay_rules, dict):
        config.update({k: v for k, v in overlay_rules.items() if v is not None})

    # 兼容扁平写法，方便以后从表单直接传值。
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

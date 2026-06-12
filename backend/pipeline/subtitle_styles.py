"""基因模板字幕/叠加样式解析。"""
from __future__ import annotations

from typing import Any, Dict, Optional

DEFAULT_SUBTITLE_STYLE = "default"
QUOTE_HIGHLIGHT_STYLE = "quote_highlight"


def resolve_subtitle_style(settings: Optional[Dict[str, Any]] = None) -> str:
    settings = settings or {}
    rules = settings.get("template_rules") or {}
    style = rules.get("subtitle_style") or DEFAULT_SUBTITLE_STYLE
    return str(style)


def should_apply_quote_overlay(style: str) -> bool:
    return style == QUOTE_HIGHLIGHT_STYLE

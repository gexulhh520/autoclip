"""将切片元数据编排为影视感金句字幕层（精简版，避免堆叠重复）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class QuoteCinemaLayer:
    role: str
    text: str
    color: str = "white"
    size_scale: float = 1.0


def _outline_title(outline: Any) -> str:
    if isinstance(outline, dict):
        return str(outline.get("title") or outline.get("outline") or "").strip()
    return str(outline or "").strip()


def _truncate(text: str, max_len: int) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _split_outline(outline: str) -> tuple[str, str]:
    parts = re.split(r"[，,。！？!?；;]", outline)
    main = (parts[0] if parts else outline).strip()
    sub = (parts[1] if len(parts) > 1 else "").strip()
    return main, sub


def _keyword(main_quote: str) -> str:
    quote = main_quote.strip()
    if not quote:
        return "金句"
    if len(quote) <= 4:
        return quote
    return quote[:4]


def _normalize_for_compare(text: str) -> str:
    return re.sub(r"[\s，,。！？!?；;：:、\-—\"'""''「」【】]", "", text or "")


def _is_duplicate(a: str, b: str) -> bool:
    na, nb = _normalize_for_compare(a), _normalize_for_compare(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def compose_quote_cinema_layers(
    clip_data: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> List[QuoteCinemaLayer]:
    """生成 4–5 层左下角字幕，避免长标题与重复文案堆叠。"""
    config = config or {}
    max_headline = int(config.get("max_headline_chars", 12) or 12)
    max_body = int(config.get("max_body_chars", 24) or 24)
    show_tagline_en = bool(config.get("show_tagline_en", False))
    caps_label = str(config.get("caps_label") or "THE MOMENT").strip().upper()

    outline = _outline_title(clip_data.get("outline"))
    content = clip_data.get("content") or []
    if isinstance(content, str):
        content = [content]
    content = [str(item).strip() for item in content if str(item).strip()]

    reason = str(clip_data.get("recommend_reason") or "").strip()
    main_quote, sub_quote = _split_outline(outline)
    if not main_quote and content:
        main_quote = _truncate(content[0], max_headline)

    headline = _truncate(main_quote, max_headline)
    if not headline:
        return []

    body = _truncate(sub_quote, max_body)
    if not body and reason:
        body = _truncate(reason.split("，")[0], max_body)
    if not body and len(content) > 1:
        body = _truncate(content[1], max_body)
    if body and _is_duplicate(body, headline):
        body = ""

    emphasis = f"{_keyword(headline)} / {caps_label}"

    layers: List[QuoteCinemaLayer] = [
        QuoteCinemaLayer("quote_mark", "“", "white", 0.55),
        QuoteCinemaLayer("headline", headline, "gold", 1.0),
    ]

    if body:
        layers.append(QuoteCinemaLayer("body", body, "white", 0.72))

    layers.append(QuoteCinemaLayer("emphasis", emphasis, "gold", 0.82))

    if show_tagline_en:
        tagline_en = str(config.get("tagline_en") or "True words last").strip()
        if tagline_en:
            layers.insert(1, QuoteCinemaLayer("tagline_en", tagline_en, "gold", 0.58))

    return [layer for layer in layers if layer.text.strip()]


def get_quote_overlay_fallback_text(
    clip_data: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> str:
    """quote_cinema 失败时，回退到 drawtext 使用的短金句。"""
    layers = compose_quote_cinema_layers(clip_data, config)
    for layer in layers:
        if layer.role == "headline" and layer.text.strip():
            return layer.text.strip()
    outline = _outline_title(clip_data.get("outline"))
    return _truncate(outline, int((config or {}).get("max_headline_chars", 12) or 12))

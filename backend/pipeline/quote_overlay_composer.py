"""将切片元数据编排为影视感金句字幕层（配置驱动，对齐基因模板 quote_overlay）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class QuoteCinemaLayer:
    role: str
    text: str
    color: str = "#FFFFFF"
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


def _normalize_for_compare(text: str) -> str:
    return re.sub(r"[\s，,。！？!?；;：:、\-—\"'""''「」【】]", "", text or "")


def _is_duplicate(a: str, b: str) -> bool:
    na, nb = _normalize_for_compare(a), _normalize_for_compare(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def _body_size_scale(config: Dict[str, Any], index: int) -> float:
    scales = config.get("body_size_scales") or [0.72, 0.65]
    if not isinstance(scales, list) or not scales:
        return 0.72
    return float(scales[min(index, len(scales) - 1)])


DEFAULT_CONTENT_PRIORITY = ["content", "outline", "recommend_reason"]
_VALID_CONTENT_SOURCES = frozenset(DEFAULT_CONTENT_PRIORITY)


def _resolve_content_priority(config: Dict[str, Any]) -> List[str]:
    raw = config.get("content_priority")
    if not isinstance(raw, list) or not raw:
        return list(DEFAULT_CONTENT_PRIORITY)
    resolved: List[str] = []
    seen: set[str] = set()
    for item in raw:
        key = str(item).strip()
        if key in _VALID_CONTENT_SOURCES and key not in seen:
            seen.add(key)
            resolved.append(key)
    return resolved or list(DEFAULT_CONTENT_PRIORITY)


def _normalize_content_items(raw_content: Any) -> List[str]:
    content = raw_content or []
    if isinstance(content, str):
        content = [content]
    return [str(item).strip() for item in content if str(item).strip()]


def _append_body_lines(
    body_lines: List[str],
    seen: set[str],
    candidates: List[str],
    *,
    max_body: int,
    max_body_points: int,
    headline: str,
) -> None:
    for candidate in candidates:
        if len(body_lines) >= max_body_points:
            break
        line = _truncate(candidate, max_body)
        norm = _normalize_for_compare(line)
        if not line or norm in seen or _is_duplicate(line, headline):
            continue
        body_lines.append(line)
        seen.add(norm)


def _compose_headline_and_body(
    clip_data: Dict[str, Any],
    config: Dict[str, Any],
) -> tuple[str, List[str]]:
    max_headline = int(config.get("max_headline_chars", 12) or 12)
    max_body = int(config.get("max_body_chars", 24) or 24)
    max_body_points = int(config.get("max_body_points", 2) or 2)

    outline = _outline_title(clip_data.get("outline"))
    content = _normalize_content_items(clip_data.get("content"))
    reason = str(clip_data.get("recommend_reason") or "").strip()
    priority = _resolve_content_priority(config)

    headline = ""
    body_lines: List[str] = []
    seen: set[str] = set()

    for source in priority:
        if source == "content" and content:
            if not headline:
                headline = _truncate(content[0], max_headline)
                seen.add(_normalize_for_compare(headline))
                _append_body_lines(
                    body_lines,
                    seen,
                    content[1 : 1 + max_body_points],
                    max_body=max_body,
                    max_body_points=max_body_points,
                    headline=headline,
                )
            elif len(body_lines) < max_body_points:
                _append_body_lines(
                    body_lines,
                    seen,
                    content,
                    max_body=max_body,
                    max_body_points=max_body_points,
                    headline=headline,
                )

        elif source == "outline" and outline:
            if not headline:
                main_quote, sub_quote = _split_outline(outline)
                headline = _truncate(main_quote, max_headline)
                if headline:
                    seen.add(_normalize_for_compare(headline))
                if sub_quote:
                    _append_body_lines(
                        body_lines,
                        seen,
                        [sub_quote],
                        max_body=max_body,
                        max_body_points=max_body_points,
                        headline=headline,
                    )
            elif len(body_lines) < max_body_points:
                _sub = _split_outline(outline)[1]
                if _sub:
                    _append_body_lines(
                        body_lines,
                        seen,
                        [_sub],
                        max_body=max_body,
                        max_body_points=max_body_points,
                        headline=headline,
                    )

        elif source == "recommend_reason" and reason:
            if headline and len(body_lines) < max_body_points:
                fallback = _truncate(reason.split("，")[0], max_body)
                _append_body_lines(
                    body_lines,
                    seen,
                    [fallback],
                    max_body=max_body,
                    max_body_points=max_body_points,
                    headline=headline,
                )

    return headline, body_lines


def compose_quote_cinema_layers(
    clip_data: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> List[QuoteCinemaLayer]:
    """按模板 quote_overlay 配置生成左下角字幕层。"""
    config = config or {}
    show_tagline_en = bool(config.get("show_tagline_en", False))
    show_quote_mark = bool(config.get("show_quote_mark", False))
    show_emphasis_line = bool(config.get("show_emphasis_line", False))

    headline_color = str(config.get("headline_color") or "#E8C872")
    body_color = str(config.get("body_color") or "#FFFFFF")
    headline_scale = float(config.get("headline_size_scale", 1.0) or 1.0)

    headline, body_lines = _compose_headline_and_body(clip_data, config)

    if not headline:
        return []

    layers: List[QuoteCinemaLayer] = []

    if show_quote_mark:
        mark_scale = float(config.get("quote_mark_size_scale", 0.55) or 0.55)
        layers.append(QuoteCinemaLayer("quote_mark", "“", body_color, mark_scale))

    layers.append(QuoteCinemaLayer("headline", headline, headline_color, headline_scale))

    if show_tagline_en:
        tagline_en = str(config.get("tagline_en") or "True words last").strip()
        if tagline_en:
            layers.append(
                QuoteCinemaLayer("tagline_en", tagline_en, headline_color, 0.58)
            )

    for idx, line in enumerate(body_lines):
        layers.append(
            QuoteCinemaLayer("body", line, body_color, _body_size_scale(config, idx))
        )

    if show_emphasis_line:
        caps_label = str(config.get("caps_label") or "THE MOMENT").strip().upper()
        keyword = headline[:4] if len(headline) > 4 else headline
        emphasis_scale = float(config.get("emphasis_size_scale", 0.82) or 0.82)
        layers.append(
            QuoteCinemaLayer(
                "emphasis",
                f"{keyword} / {caps_label}",
                headline_color,
                emphasis_scale,
            )
        )

    return [layer for layer in layers if layer.text.strip()]


def get_quote_overlay_fallback_text(
    clip_data: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> str:
    """quote_cinema 失败时，回退到 drawtext 使用的短金句。"""
    config = config or {}
    max_headline = int(config.get("max_headline_chars", 12) or 12)
    headline, _ = _compose_headline_and_body(clip_data, config)
    if headline:
        return headline

    outline = _outline_title(clip_data.get("outline"))
    return _truncate(outline, max_headline)

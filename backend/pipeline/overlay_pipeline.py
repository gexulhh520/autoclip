"""统一 overlay 管线：模板 → composer → layers → renderer。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from backend.pipeline.quote_overlay_composer import (
    QuoteCinemaLayer,
    compose_quote_cinema_layers,
    get_quote_overlay_fallback_text,
)
from backend.pipeline.subtitle_styles import (
    DEFAULT_SUBTITLE_STYLE,
    QUOTE_CINEMA_STYLE,
    QUOTE_HIGHLIGHT_STYLE,
    resolve_quote_overlay_config,
)

COMPOSER_NONE = "none"
COMPOSER_QUOTE_CINEMA = "quote_cinema"
COMPOSER_QUOTE_HIGHLIGHT = "quote_highlight"

RENDERER_NONE = "none"
RENDERER_ASS_STACK = "ass_stack"
RENDERER_DRAWTEXT = "drawtext"

_LEGACY_STYLE_PIPELINE: Dict[str, tuple[str, str]] = {
    DEFAULT_SUBTITLE_STYLE: (COMPOSER_NONE, RENDERER_NONE),
    QUOTE_HIGHLIGHT_STYLE: (COMPOSER_QUOTE_HIGHLIGHT, RENDERER_DRAWTEXT),
    QUOTE_CINEMA_STYLE: (COMPOSER_QUOTE_CINEMA, RENDERER_ASS_STACK),
}


def compose_quote_highlight_layers(
    clip_data: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> List[QuoteCinemaLayer]:
    text = get_quote_overlay_fallback_text(clip_data, config)
    if not text:
        return []
    return [QuoteCinemaLayer("headline", text, "white", 1.0)]


ComposerFn = Callable[[Dict[str, Any], Optional[Dict[str, Any]]], List[QuoteCinemaLayer]]

COMPOSER_REGISTRY: Dict[str, ComposerFn] = {
    COMPOSER_NONE: lambda _clip, _cfg: [],
    COMPOSER_QUOTE_CINEMA: compose_quote_cinema_layers,
    COMPOSER_QUOTE_HIGHLIGHT: compose_quote_highlight_layers,
}


@dataclass(frozen=True)
class OverlayPipeline:
    """Step6 / 预览校准共用的 overlay 解析结果。"""

    composer: str
    renderer: str
    config: Dict[str, Any]
    subtitle_style: str
    template_version: Optional[str] = None


def normalize_overlay_rules(rules: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """从 template_rules 提取 overlay 块，合并 legacy quote_overlay。"""
    rules = dict(rules or {})
    overlay_block = rules.get("overlay") or {}
    if not isinstance(overlay_block, dict):
        overlay_block = {}

    subtitle_style = str(rules.get("subtitle_style") or DEFAULT_SUBTITLE_STYLE)
    legacy_composer, legacy_renderer = _LEGACY_STYLE_PIPELINE.get(
        subtitle_style,
        (COMPOSER_NONE, RENDERER_NONE),
    )

    composer = str(overlay_block.get("composer") or legacy_composer)
    renderer = str(overlay_block.get("renderer") or legacy_renderer)

    legacy_config = rules.get("quote_overlay") or rules.get("subtitle_overlay") or {}
    explicit_config = overlay_block.get("config") or {}
    if not isinstance(legacy_config, dict):
        legacy_config = {}
    if not isinstance(explicit_config, dict):
        explicit_config = {}

    merged_config = {**legacy_config, **explicit_config}
    return {
        "composer": composer,
        "renderer": renderer,
        "config": merged_config,
    }


def pipeline_to_subtitle_style(composer: str, renderer: str) -> str:
    if composer == COMPOSER_QUOTE_CINEMA and renderer == RENDERER_ASS_STACK:
        return QUOTE_CINEMA_STYLE
    if composer == COMPOSER_QUOTE_HIGHLIGHT or renderer == RENDERER_DRAWTEXT:
        return QUOTE_HIGHLIGHT_STYLE
    return DEFAULT_SUBTITLE_STYLE


def resolve_overlay_pipeline(settings: Optional[Dict[str, Any]] = None) -> OverlayPipeline:
    """单一入口：解析 composer / renderer / 排版 config / legacy subtitle_style。"""
    settings = dict(settings or {})
    rules = dict(settings.get("template_rules") or {})
    template_version = settings.get("template_version")

    normalized = normalize_overlay_rules(rules)
    composer = normalized["composer"]
    renderer = normalized["renderer"]
    raw_config = dict(normalized["config"])

    frozen = settings.get("overlay")
    if isinstance(frozen, dict) and frozen:
        composer = str(frozen.get("composer") or composer)
        renderer = str(frozen.get("renderer") or renderer)
        frozen_config = frozen.get("config") or {}
        if isinstance(frozen_config, dict):
            raw_config = {**raw_config, **frozen_config}

    subtitle_style = pipeline_to_subtitle_style(composer, renderer)
    config = resolve_quote_overlay_config(
        {
            "template_rules": {
                **rules,
                "subtitle_style": subtitle_style,
                "quote_overlay": raw_config,
            }
        }
    )

    return OverlayPipeline(
        composer=composer,
        renderer=renderer,
        config=config,
        subtitle_style=subtitle_style,
        template_version=str(template_version) if template_version else None,
    )


def compose_overlay_layers(
    clip_data: Dict[str, Any],
    pipeline: OverlayPipeline,
) -> List[QuoteCinemaLayer]:
    composer_fn = COMPOSER_REGISTRY.get(pipeline.composer)
    if not composer_fn:
        return []
    return composer_fn(clip_data, pipeline.config)


def build_overlay_layout_config(
    config: Dict[str, Any],
    *,
    ref_width: int = 720,
    ref_height: int = 1280,
) -> Dict[str, Any]:
    margin_left = int(
        config.get("margin_left")
        or max(40, ref_width * float(config.get("margin_left_ratio", 0.055) or 0.055))
    )
    margin_right = int(config.get("margin_right") or margin_left)
    margin_bottom = int(
        config.get("margin_bottom")
        or max(56, ref_height * float(config.get("margin_bottom_ratio", 0.11) or 0.11))
    )
    base_font_size = int(
        config.get(
            "base_font_size",
            max(28, min(36, int(ref_height * 0.048))),
        )
    )
    return {
        "margin_left": margin_left,
        "margin_right": margin_right,
        "margin_bottom": margin_bottom,
        "base_font_size": base_font_size,
        "margin_left_pct": round(margin_left / ref_width * 100, 2),
        "margin_right_pct": round(margin_right / ref_width * 100, 2),
        "margin_bottom_pct": round(margin_bottom / ref_height * 100, 2),
        "headline_color": config.get("headline_color"),
        "body_color": config.get("body_color"),
        "alignment": config.get("alignment", "bottom-left"),
        "color_preset": config.get("color_preset"),
        "ref_width": ref_width,
        "ref_height": ref_height,
    }


def build_overlay_preview(
    clip_data: Dict[str, Any],
    pipeline: OverlayPipeline,
    *,
    ref_width: int = 720,
    ref_height: int = 1280,
) -> Dict[str, Any]:
    """预览校准 API 与 Step6 共用的 overlay 预览结构。"""
    layout_config = build_overlay_layout_config(
        pipeline.config,
        ref_width=ref_width,
        ref_height=ref_height,
    )

    if pipeline.composer == COMPOSER_NONE or pipeline.renderer == RENDERER_NONE:
        return {
            "subtitle_style": pipeline.subtitle_style,
            "composer": pipeline.composer,
            "renderer": pipeline.renderer,
            "applicable": False,
            "layout": "none",
            "layers": [],
            "config": layout_config,
            "message": "当前模板导出时不叠加字幕",
        }

    layers = compose_overlay_layers(clip_data, pipeline)
    if pipeline.composer == COMPOSER_QUOTE_CINEMA:
        return {
            "subtitle_style": pipeline.subtitle_style,
            "composer": pipeline.composer,
            "renderer": pipeline.renderer,
            "applicable": bool(layers),
            "layout": "cinema",
            "layers": [
                {
                    "role": layer.role,
                    "text": layer.text,
                    "color": layer.color,
                    "size_scale": layer.size_scale,
                }
                for layer in layers
            ],
            "config": layout_config,
        }

    if pipeline.composer == COMPOSER_QUOTE_HIGHLIGHT:
        if not layers:
            return {
                "subtitle_style": pipeline.subtitle_style,
                "composer": pipeline.composer,
                "renderer": pipeline.renderer,
                "applicable": False,
                "layout": "none",
                "layers": [],
                "config": layout_config,
                "message": "暂无可用字幕文案",
            }
        return {
            "subtitle_style": pipeline.subtitle_style,
            "composer": pipeline.composer,
            "renderer": pipeline.renderer,
            "applicable": True,
            "layout": "highlight",
            "layers": [
                {
                    "role": layer.role,
                    "text": layer.text,
                    "color": layer.color,
                    "size_scale": layer.size_scale,
                }
                for layer in layers
            ],
            "config": {
                **layout_config,
                "font_size": int(pipeline.config.get("font_size", 42) or 42),
                "margin_bottom": int(pipeline.config.get("margin_bottom", 80) or 80),
            },
        }

    return {
        "subtitle_style": pipeline.subtitle_style,
        "composer": pipeline.composer,
        "renderer": pipeline.renderer,
        "applicable": bool(layers),
        "layout": pipeline.composer,
        "layers": [
            {
                "role": layer.role,
                "text": layer.text,
                "color": layer.color,
                "size_scale": layer.size_scale,
            }
            for layer in layers
        ],
        "config": layout_config,
    }


def build_overlay_snapshot(settings: Dict[str, Any]) -> Dict[str, Any]:
    """写入项目 metadata 的 overlay 快照（创建项目时冻结）。"""
    pipeline = resolve_overlay_pipeline(settings)
    rules = settings.get("template_rules") or {}
    normalized = normalize_overlay_rules(rules)
    raw_config = normalized.get("config") or {}
    return {
        "composer": pipeline.composer,
        "renderer": pipeline.renderer,
        "config": raw_config,
    }

"""口播 TTS 时间戳 → 时间线字幕 overlay。"""
from __future__ import annotations

import re
import uuid
from typing import List, Literal

from backend.schemas.edit_session import EditOverlayElement, EditSession
from backend.services.voiceover_subtitle_regroup import (
    SubtitleDisplayRules,
    regroup_words_to_display_cues,
)
from backend.utils.edge_tts_service import SubtitleCueTiming, SynthesizedSpeech

DEFAULT_TEXT_TRACK_ID = "default-text"
TIMELINE_BLOCK_ID_PARAM = "timeline.blockId"
TIMELINE_BLOCK_OFFSET_PARAM = "timeline.blockOffsetSec"


def _canvas_size(session: EditSession) -> tuple[float, float]:
    settings = session.export_settings
    if settings is None:
        return 608.0, 1080.0
    height = float(settings.height or 1080)
    aspect = str(settings.aspect or "9:16")
    if aspect == "16:9":
        width = height * 16 / 9
    elif aspect == "1:1":
        width = height
    elif aspect == "4:3":
        width = height * 4 / 3
    elif aspect == "custom" and settings.custom_width and settings.custom_height:
        width = float(settings.custom_width)
        height = float(settings.custom_height)
    else:
        width = height * 9 / 16
    return width, height


def _bottom_center_position(session: EditSession) -> tuple[float, float]:
    width, height = _canvas_size(session)
    normalized_x = 0.5
    normalized_y = 0.8
    return normalized_x * width - width / 2, normalized_y * height - height / 2


def _subtitle_font_size(text: str, session: EditSession) -> float:
    settings = session.export_settings
    aspect = str(getattr(settings, "aspect", None) or "9:16")
    char_count = len(re.sub(r"\s+", "", text))
    base = 6.5 if aspect == "16:9" else 6.0
    if char_count > 14:
        return max(5.0, base - 1.5)
    if char_count > 10:
        return max(5.0, base - 0.75)
    return base


def build_display_cues_from_speech(
    speech: SynthesizedSpeech,
    session: EditSession,
) -> List[SubtitleCueTiming]:
    """词级 TTS 时间轴经编组规则生成屏幕显示字幕。"""
    rules = SubtitleDisplayRules.from_session(session)
    return regroup_words_to_display_cues(
        speech.word_timings,
        rules,
        sentence_fallback=speech.cues,
    )


def build_voiceover_overlays(
    cues: List[SubtitleCueTiming],
    *,
    session: EditSession,
    block_id: str,
    block_timeline_start_sec: float,
    alignment: Literal["sentence", "word"] = "sentence",
) -> List[EditOverlayElement]:
    if not cues:
        return []

    position_x, position_y = _bottom_center_position(session)
    use_word = alignment == "word"
    source = cues if not use_word else _word_level_cues(cues)
    overlays: List[EditOverlayElement] = []

    for cue in source:
        text = cue.text.strip()
        if not text:
            continue
        offset_sec = max(0.0, cue.start_sec)
        duration_sec = max(0.08, cue.end_sec - cue.start_sec)
        overlay_id = f"vo-sub-{uuid.uuid4().hex[:12]}"
        font_size = _subtitle_font_size(text, session)
        overlays.append(
            EditOverlayElement(
                id=overlay_id,
                type="text",
                start_sec=block_timeline_start_sec + offset_sec,
                duration_sec=duration_sec,
                track_id=DEFAULT_TEXT_TRACK_ID,
                params={
                    "content": text,
                    "fontSize": font_size,
                    "fontFamily": "Noto Sans SC",
                    "color": "#ffffff",
                    "textAlign": "center",
                    "fontWeight": "normal",
                    "fontStyle": "normal",
                    "textDecoration": "none",
                    "letterSpacing": 0,
                    "lineHeight": 1.2,
                    "background.enabled": False,
                    "background.color": "#000000",
                    "background.cornerRadius": 0,
                    "background.paddingX": 30,
                    "background.paddingY": 42,
                    "background.offsetX": 0,
                    "background.offsetY": 0,
                    "transform.positionX": position_x,
                    "transform.positionY": position_y,
                    "transform.scaleX": 1,
                    "transform.scaleY": 1,
                    "transform.rotate": 0,
                    "opacity": 1,
                    "blendMode": "normal",
                    TIMELINE_BLOCK_ID_PARAM: block_id,
                    TIMELINE_BLOCK_OFFSET_PARAM: offset_sec,
                },
            )
        )
    return overlays


def _word_level_cues(cues: List[SubtitleCueTiming]) -> List[SubtitleCueTiming]:
    expanded: List[SubtitleCueTiming] = []
    for cue in cues:
        if cue.boundary_type in ("WordBoundary", "WordEstimate"):
            expanded.append(cue)
            continue
        from backend.utils.edge_tts_service import _expand_word_timings

        expanded.extend(_expand_word_timings([cue]))
    return expanded

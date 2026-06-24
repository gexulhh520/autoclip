"""口播 TTS 时间戳 → 时间线字幕 overlay。"""
from __future__ import annotations

import uuid
from typing import List, Literal, Optional

from backend.schemas.edit_session import EditOverlayElement, EditSession
from backend.utils.edge_tts_service import SubtitleCueTiming

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
        overlays.append(
            EditOverlayElement(
                id=overlay_id,
                type="text",
                start_sec=block_timeline_start_sec + offset_sec,
                duration_sec=duration_sec,
                track_id=DEFAULT_TEXT_TRACK_ID,
                params={
                    "content": text,
                    "fontSize": 6,
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

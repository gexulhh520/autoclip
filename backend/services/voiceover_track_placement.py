"""口播 B-roll 轨道放置：主轨为空时写主轨，否则走 overlay 轨。"""
from __future__ import annotations

from typing import List, Optional, Tuple

from backend.schemas.edit_session import EditBlock, EditSession
from backend.schemas.voiceover_plan import VoiceoverPlan, VoiceoverSegment

DEFAULT_VIDEO_TRACK_ID = "default-video"
VOICEOVER_BROLL_TRACK_ID = "voiceover-broll"
BROLL_BLOCK_TITLE_PREFIX = "口播素材-"


def is_main_track_block(block: EditBlock) -> bool:
    track_id = (block.track_id or "").strip()
    return not track_id or track_id == DEFAULT_VIDEO_TRACK_ID


def is_main_track_empty(session: EditSession) -> bool:
    return not any(is_main_track_block(block) for block in (session.sequence or []))


def should_use_main_track_for_voiceover(session: EditSession) -> bool:
    return is_main_track_empty(session)


def should_insert_voiceover_broll_on_main_track(
    session: EditSession,
    *,
    audio_timeline_start_sec: float,
) -> bool:
    """主轨为空且该段口播从 0s 开始时写入主轨；否则叠画轨并按 audio_timeline_start_sec 对齐。"""
    if not is_main_track_empty(session):
        return False
    return float(audio_timeline_start_sec) <= 0.001


def is_voiceover_broll_block(block: EditBlock) -> bool:
    if (block.track_id or "").strip() == VOICEOVER_BROLL_TRACK_ID:
        return True
    return str(block.title or "").startswith(BROLL_BLOCK_TITLE_PREFIX)


def segment_index_for_block(
    block: EditBlock,
    plan: Optional[VoiceoverPlan] = None,
) -> Optional[int]:
    if plan is not None:
        for segment in plan.segments:
            if segment.broll.block_id == block.id:
                return segment.index
    title = str(block.title or "")
    if not title.startswith(BROLL_BLOCK_TITLE_PREFIX):
        return None
    suffix = title[len(BROLL_BLOCK_TITLE_PREFIX) :].strip()
    if suffix.isdigit():
        return int(suffix)
    return None


def resolve_main_track_insert_index(
    session: EditSession,
    plan: VoiceoverPlan,
    segment: VoiceoverSegment,
) -> int:
    target_index = segment.index
    last_position = -1
    for idx, block in enumerate(session.sequence or []):
        if not is_main_track_block(block):
            continue
        segment_index = segment_index_for_block(block, plan)
        if segment_index is not None and segment_index < target_index:
            last_position = idx
    if last_position >= 0:
        return last_position + 1
    for idx, block in enumerate(session.sequence or []):
        if not is_main_track_block(block):
            return idx
    return len(session.sequence or [])


def apply_main_track_placement_to_block_data(data: dict) -> dict:
    data["track_id"] = DEFAULT_VIDEO_TRACK_ID
    data["timeline_start_sec"] = None
    return data


def apply_overlay_track_placement_to_block_data(data: dict, timeline_start_sec: float) -> dict:
    data["track_id"] = VOICEOVER_BROLL_TRACK_ID
    data["timeline_start_sec"] = round(float(timeline_start_sec), 3)
    return data


def reorder_sequence_voiceover_on_main(
    sequence: List[EditBlock],
    plan: VoiceoverPlan,
) -> List[EditBlock]:
    voiceover_block_ids = {
        block.id
        for block in sequence
        if is_voiceover_broll_block(block) or segment_index_for_block(block, plan) is not None
    }
    if not voiceover_block_ids:
        return sequence

    voiceover_blocks = [block for block in sequence if block.id in voiceover_block_ids]
    other_blocks = [block for block in sequence if block.id not in voiceover_block_ids]
    voiceover_blocks.sort(key=lambda block: segment_index_for_block(block, plan) or 9999)
    return voiceover_blocks + other_blocks


def migrate_voiceover_blocks_to_main_track(
    session: EditSession,
    plan: VoiceoverPlan,
) -> Tuple[List[EditBlock], bool]:
    if not should_use_main_track_for_voiceover(session):
        return list(session.sequence or []), False

    changed = False
    updated: List[EditBlock] = []
    for block in session.sequence or []:
        if not is_voiceover_broll_block(block) and (
            block.track_id or ""
        ).strip() != VOICEOVER_BROLL_TRACK_ID:
            updated.append(block)
            continue
        if is_main_track_block(block) and block.timeline_start_sec is None:
            updated.append(block)
            continue
        data = block.model_dump()
        apply_main_track_placement_to_block_data(data)
        updated.append(EditBlock.model_validate(data))
        changed = True

    if changed:
        updated = reorder_sequence_voiceover_on_main(updated, plan)
    return updated, changed

"""口播 B-roll 轨道放置：按该段音频时间窗是否与主轨画面重叠决定主轨/叠画轨。"""
from __future__ import annotations

from typing import List, Optional, Tuple

from backend.pipeline.scene_builder import build_composition_timeline
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


def _block_playback_rate(block: EditBlock) -> float:
    rate = float(block.playback_rate or 1.0)
    return max(0.25, min(4.0, rate))


def main_track_block_visual_window(
    composition_start_sec: float,
    block: EditBlock,
) -> Tuple[float, float]:
    rate = _block_playback_rate(block)
    visual_start = composition_start_sec + float(block.trim.in_sec or 0.0) / rate
    visual_end = composition_start_sec + float(block.trim.out_sec or 0.0) / rate
    return visual_start, visual_end


def _ranges_overlap(
    a_start: float,
    a_end: float,
    b_start: float,
    b_end: float,
    *,
    eps: float = 0.001,
) -> bool:
    return a_start < b_end - eps and b_start < a_end - eps


def _main_track_blocks(
    session: EditSession,
    *,
    exclude_block_id: Optional[str] = None,
) -> List[EditBlock]:
    blocks = [block for block in (session.sequence or []) if is_main_track_block(block)]
    if exclude_block_id:
        blocks = [block for block in blocks if block.id != exclude_block_id]
    return blocks


def main_track_has_video_in_range(
    session: EditSession,
    start_sec: float,
    end_sec: float,
    *,
    exclude_block_id: Optional[str] = None,
) -> bool:
    """该合成时间区间内主轨是否已有视频（按可视 in/out 判断）。"""
    main_blocks = _main_track_blocks(session, exclude_block_id=exclude_block_id)
    if not main_blocks:
        return False
    transition = float(session.audio_settings.transition_duration_sec or 0.35)
    timeline = build_composition_timeline(main_blocks, transition)
    window_start = float(start_sec)
    window_end = max(window_start + 0.001, float(end_sec))
    for segment in timeline.segments:
        vis_start, vis_end = main_track_block_visual_window(
            segment.composition_start_sec,
            segment.block,
        )
        if _ranges_overlap(vis_start, vis_end, window_start, window_end):
            return True
    return False


def main_track_composition_visual_end_sec(
    session: EditSession,
    *,
    exclude_block_id: Optional[str] = None,
) -> float:
    main_blocks = _main_track_blocks(session, exclude_block_id=exclude_block_id)
    if not main_blocks:
        return 0.0
    transition = float(session.audio_settings.transition_duration_sec or 0.35)
    timeline = build_composition_timeline(main_blocks, transition)
    last = timeline.segments[-1]
    _, vis_end = main_track_block_visual_window(last.composition_start_sec, last.block)
    return float(vis_end)


def should_insert_voiceover_broll_on_main_track(
    session: EditSession,
    *,
    audio_timeline_start_sec: float,
    audio_timeline_end_sec: float,
    exclude_block_id: Optional[str] = None,
) -> bool:
    """该段音频时间窗内主轨无画面冲突，且可顺序接在主轨末尾（或从 0s 起）时写入主轨。"""
    start = float(audio_timeline_start_sec)
    end = max(start + 0.001, float(audio_timeline_end_sec))
    if main_track_has_video_in_range(
        session,
        start,
        end,
        exclude_block_id=exclude_block_id,
    ):
        return False
    if start <= 0.001:
        return True
    main_end = main_track_composition_visual_end_sec(
        session,
        exclude_block_id=exclude_block_id,
    )
    return abs(main_end - start) <= 0.05


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

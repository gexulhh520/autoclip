"""口播时间线同步：B-roll 应用后仅持久化 plan，不批量移动已对齐音频的字幕。"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from backend.pipeline.scene_builder import build_composition_timeline
from backend.schemas.edit_session import (
    AudioClipElement,
    EditOverlayElement,
    EditSession,
    EditSessionUpdateRequest,
)
from backend.schemas.voiceover_plan import VoiceoverPlan, VoiceoverSegment
from backend.services.edit_session_service import EditSessionService
from backend.services.voiceover_subtitle_builder import (
    TIMELINE_BLOCK_ID_PARAM,
    TIMELINE_BLOCK_OFFSET_PARAM,
)
from backend.services.voiceover_track_placement import (
    BROLL_BLOCK_TITLE_PREFIX,
    is_main_track_block,
    should_use_main_track_for_voiceover,
)


def is_voiceover_broll_block(block_id: str, session: EditSession, plan: Optional[VoiceoverPlan] = None) -> bool:
    block = next((item for item in (session.sequence or []) if item.id == block_id), None)
    if block is None:
        return False
    title = str(block.title or "")
    if title.startswith(BROLL_BLOCK_TITLE_PREFIX):
        return True
    if plan is None:
        return False
    return any(seg.broll.block_id == block_id for seg in plan.segments)


def _main_track_blocks(session: EditSession):
    return [block for block in (session.sequence or []) if is_main_track_block(block)]


def _block_composition_starts(session: EditSession) -> Dict[str, float]:
    transition = float(session.audio_settings.transition_duration_sec or 0.35)
    timeline = build_composition_timeline(_main_track_blocks(session), transition)
    return {
        segment.block.id: float(segment.composition_start_sec)
        for segment in timeline.segments
    }


def _overlay_cue_offset_sec(overlay: EditOverlayElement, fallback_timeline_start: float) -> float:
    params = overlay.params or {}
    raw = params.get(TIMELINE_BLOCK_OFFSET_PARAM)
    if raw is not None:
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            pass
    return max(0.0, float(overlay.start_sec) - float(fallback_timeline_start))


def _block_timeline_duration_sec(session: EditSession, block_id: str) -> float:
    block = next((item for item in (session.sequence or []) if item.id == block_id), None)
    if block is None:
        return 0.0
    trim_span = float(block.trim.out_sec) - float(block.trim.in_sec)
    if trim_span > 0:
        rate = float(block.playback_rate or 1.0)
        rate = max(0.25, min(4.0, rate))
        return trim_span / rate
    return float(block.duration_sec or 0.0)


def should_repack_voiceover_main_track_timeline(
    session: EditSession,
    plan: VoiceoverPlan,
) -> bool:
    block_ids = {
        (seg.broll.block_id or "").strip()
        for seg in plan.segments
        if (seg.broll.block_id or "").strip()
    }
    for block in session.sequence or []:
        if not is_main_track_block(block):
            continue
        if block.id in block_ids:
            return True
        if str(block.title or "").startswith(BROLL_BLOCK_TITLE_PREFIX):
            return True
    return should_use_main_track_for_voiceover(session)


def repack_voiceover_main_track_timeline(
    session: EditSession,
    plan: VoiceoverPlan,
) -> Tuple[EditSession, VoiceoverPlan, bool]:
    if not should_repack_voiceover_main_track_timeline(session, plan):
        return session, plan, False

    comp_starts = _block_composition_starts(session)
    ordered = sorted(plan.segments, key=lambda row: row.index)
    changed = False
    anchor = 0.0
    new_segments: List[VoiceoverSegment] = []

    overlay_by_id = {
        item.id: item.model_copy(deep=True)
        for item in (session.overlay_elements or [])
    }
    audio_by_id = {
        item.id: item.model_copy(deep=True) for item in (session.audio_elements or [])
    }

    for segment in ordered:
        block_id = (segment.broll.block_id or "").strip() or None
        if block_id and block_id in comp_starts:
            comp_start = comp_starts[block_id]
        else:
            comp_start = anchor

        old_timeline_start = float(segment.tts.timeline_start_sec or 0.0)
        for overlay_id in segment.subtitles.overlay_ids or []:
            overlay = overlay_by_id.get(overlay_id)
            if overlay is None:
                continue
            offset_sec = _overlay_cue_offset_sec(overlay, old_timeline_start)
            next_start = round(comp_start + offset_sec, 3)
            params = dict(overlay.params or {})
            if block_id:
                params[TIMELINE_BLOCK_ID_PARAM] = block_id
                params[TIMELINE_BLOCK_OFFSET_PARAM] = round(offset_sec, 3)
            else:
                params.pop(TIMELINE_BLOCK_ID_PARAM, None)
                params.pop(TIMELINE_BLOCK_OFFSET_PARAM, None)
            if (
                abs(overlay.start_sec - next_start) > 0.001
                or params != (overlay.params or {})
            ):
                changed = True
            overlay.start_sec = next_start
            overlay.params = params

        clip_id = (segment.tts.audio_clip_id or "").strip()
        if clip_id:
            clip = audio_by_id.get(clip_id)
            if clip is not None:
                next_block_id = block_id or None
                next_offset = 0.0 if block_id else None
                clip_changed = (
                    abs(clip.start_sec - comp_start) > 0.001
                    or clip.block_id != next_block_id
                    or clip.block_offset_sec != next_offset
                )
                if clip_changed:
                    changed = True
                    clip = clip.model_copy(deep=True)
                    clip.start_sec = comp_start
                    clip.block_id = next_block_id
                    clip.block_offset_sec = next_offset
                    audio_by_id[clip_id] = clip

        updated = segment.model_copy(deep=True)
        if updated.tts.timeline_start_sec != comp_start:
            updated.tts.timeline_start_sec = comp_start
            changed = True
        new_segments.append(updated)

        duration = float(updated.tts.duration_sec or 0.0)
        if block_id and block_id in comp_starts:
            anchor = comp_starts[block_id] + _block_timeline_duration_sec(session, block_id)
        elif duration > 0:
            anchor = comp_start + duration

    if not changed:
        return session, plan, False

    overlay_order = [item.id for item in (session.overlay_elements or [])]
    audio_order = [item.id for item in (session.audio_elements or [])]
    overlays = [overlay_by_id[item_id] for item_id in overlay_order if item_id in overlay_by_id]
    audio_elements = [audio_by_id[item_id] for item_id in audio_order if item_id in audio_by_id]

    plan = plan.model_copy(deep=True)
    plan.segments = new_segments
    session = session.model_copy(
        update={
            "overlay_elements": overlays,
            "audio_elements": audio_elements,
        }
    )
    return session, plan, True


class VoiceoverTimelineSyncService:
    def __init__(self, session_service: Optional[EditSessionService] = None):
        self.session_service = session_service or EditSessionService()

    def sync_after_broll_apply(
        self,
        project_id: str,
        session_id: str,
        session: EditSession,
        plan: VoiceoverPlan,
    ) -> Tuple[EditSession, VoiceoverPlan]:
        """应用 B-roll 后保留 TTS 音频/字幕时间轴；画面已在 _sync_broll_block_audio_alignment 对齐。"""
        _ = session
        self._save_plan(project_id, session_id, plan)
        return self.session_service.get_session(project_id, session_id), plan

    def _save_plan(self, project_id: str, session_id: str, plan: VoiceoverPlan) -> EditSession:
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(voiceover_plan=plan),
        )

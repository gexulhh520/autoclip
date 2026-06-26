"""口播主轨时间线同步单元测试。"""
from __future__ import annotations

import pytest

from backend.schemas.edit_session import (
    AudioClipElement,
    EditBlock,
    EditBlockMedia,
    EditBlockOverlay,
    EditBlockTrim,
    EditOverlayElement,
    EditSession,
)
from backend.schemas.voiceover_plan import (
    VoiceoverBrollState,
    VoiceoverPlan,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
    VoiceoverSubtitleState,
    VoiceoverTtsState,
)
from backend.services.voiceover_subtitle_builder import (
    TIMELINE_BLOCK_ID_PARAM,
    TIMELINE_BLOCK_OFFSET_PARAM,
)
from backend.services.voiceover_timeline_sync import (
    VoiceoverTimelineSyncService,
    repack_voiceover_main_track_timeline,
)
from backend.services.voiceover_track_placement import BROLL_BLOCK_TITLE_PREFIX


def _block(block_id: str, *, trim_in: float, trim_out: float) -> EditBlock:
    return EditBlock(
        id=block_id,
        source_clip_id=f"import-{block_id}",
        title=f"{BROLL_BLOCK_TITLE_PREFIX}1",
        media=EditBlockMedia(type="imported_clip", path=f"{block_id}.mp4"),
        trim=EditBlockTrim(in_sec=trim_in, out_sec=trim_out),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=trim_out - trim_in,
        track_id="default-video",
    )


def test_repack_keeps_subtitles_and_audio_at_composition_start_with_trim_in():
    block = _block("block-1", trim_in=1.5, trim_out=19.21)
    overlay = EditOverlayElement(
        id="vo-sub-1",
        type="text",
        start_sec=1.5,
        duration_sec=2.0,
        params={
            TIMELINE_BLOCK_ID_PARAM: "block-1",
            TIMELINE_BLOCK_OFFSET_PARAM: 0.5,
        },
    )
    audio = AudioClipElement(
        id="vo-audio-1",
        asset_id="audio-1",
        start_sec=1.5,
        duration_sec=17.71,
        block_id="block-1",
        block_offset_sec=0.0,
    )
    session = EditSession(
        id="sess-1",
        project_id="proj-1",
        name="test",
        sequence=[block],
        overlay_elements=[overlay],
        audio_elements=[audio],
        created_at="",
        updated_at="",
    )
    plan = VoiceoverPlan(
        id="plan-1",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="测试",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(
                    audio_clip_id="vo-audio-1",
                    duration_sec=17.71,
                    timeline_start_sec=1.5,
                ),
                broll=VoiceoverBrollState(block_id="block-1"),
                subtitles=VoiceoverSubtitleState(overlay_ids=["vo-sub-1"]),
            )
        ],
    )

    session, plan, changed = repack_voiceover_main_track_timeline(session, plan)

    assert changed is True
    assert session.audio_elements[0].start_sec == 0.0
    assert session.audio_elements[0].block_offset_sec == 0.0
    assert session.overlay_elements[0].start_sec == 0.5
    assert session.overlay_elements[0].params[TIMELINE_BLOCK_OFFSET_PARAM] == 0.5
    assert plan.segments[0].tts.timeline_start_sec == 0.0


def test_sync_after_broll_apply_does_not_repack_subtitles():
    block = _block("block-1", trim_in=0.0, trim_out=5.0)
    overlay = EditOverlayElement(
        id="vo-sub-1",
        type="text",
        start_sec=1.25,
        duration_sec=2.0,
        params={
            TIMELINE_BLOCK_ID_PARAM: "block-1",
            TIMELINE_BLOCK_OFFSET_PARAM: 1.25,
        },
    )
    audio = AudioClipElement(
        id="vo-audio-1",
        asset_id="audio-1",
        start_sec=0.0,
        duration_sec=5.0,
        block_id="block-1",
        block_offset_sec=0.0,
    )
    session = EditSession(
        id="sess-1",
        project_id="proj-1",
        name="test",
        sequence=[block],
        overlay_elements=[overlay],
        audio_elements=[audio],
        created_at="",
        updated_at="",
    )
    plan = VoiceoverPlan(
        id="plan-1",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="测试",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(
                    audio_clip_id="vo-audio-1",
                    duration_sec=5.0,
                    timeline_start_sec=0.0,
                ),
                broll=VoiceoverBrollState(block_id="block-1"),
                subtitles=VoiceoverSubtitleState(overlay_ids=["vo-sub-1"]),
            )
        ],
    )

    class _FakeSessionService:
        def update_session(self, project_id, session_id, request):
            assert request.voiceover_plan is not None
            assert request.overlay_elements is None
            assert request.audio_elements is None
            return session

    sync = VoiceoverTimelineSyncService(_FakeSessionService())
    out_session, out_plan = sync.sync_after_broll_apply("proj-1", "sess-1", session, plan)

    assert out_session.overlay_elements[0].start_sec == pytest.approx(1.25)
    assert out_session.audio_elements[0].start_sec == pytest.approx(0.0)
    assert out_plan.segments[0].tts.timeline_start_sec == pytest.approx(0.0)

"""口播里程碑 C 单元测试。"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.schemas.edit_session import (
    EditBlock,
    EditBlockMedia,
    EditBlockOverlay,
    EditBlockTrim,
    EditSessionUpdateRequest,
)
from backend.schemas.voiceover_plan import (
    VoiceoverBrollState,
    VoiceoverPlan,
    VoiceoverSearchResult,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
    VoiceoverTtsState,
)
from backend.services.material_download_service import format_material_download_error
from backend.services.edit_session_service import EditSessionService
from backend.services.voiceover_broll_service import BROLL_BLOCK_TITLE_PREFIX, VoiceoverBrollService

from backend.services.voiceover_broll_selection import (
    align_interval_to_target_duration,
    apply_manual_trim_override,
    build_broll_search_criteria,
    pick_best_semantic_match,
)


def test_format_material_download_error_unavailable_video():
    raw = "ERROR: [youtube] S8pbUz2OpqE: This video is not available"
    message = format_material_download_error(raw)
    assert "不可用" in message
    assert "换一条候选" in message


def test_wait_for_material_download_raises_on_failed_task(monkeypatch):
    task_state = {
        "id": "mdl-failed",
        "status": "failed",
        "error_message": "ERROR: [youtube] abc: This video is not available",
    }

    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.get_download_task",
        lambda _task_id: task_state,
    )
    monkeypatch.setattr("backend.services.voiceover_broll_service.time.sleep", lambda _sec: None)

    with pytest.raises(ValueError, match="不可用"):
        VoiceoverBrollService.wait_for_material_download("mdl-failed", timeout_sec=10.0)


def test_build_broll_search_criteria_combines_brief_and_narration():
    text = build_broll_search_criteria(
        visual_brief="产品桌面俯拍",
        narration_text="这是口播正文。",
    )
    assert "产品桌面俯拍" in text
    assert "口播正文" in text


def test_align_interval_to_target_duration_from_semantic_match():
    selection = align_interval_to_target_duration(
        match_in_sec=12.0,
        match_out_sec=28.0,
        target_duration_sec=5.0,
        source_duration_sec=120.0,
        match_reason="画面符合描述",
        match_score=0.82,
    )
    assert selection.source_out_sec - selection.source_in_sec == pytest.approx(5.0, abs=0.11)
    assert "语义检索命中" in selection.selection_reason
    assert "画面符合描述" in selection.selection_reason


def test_align_interval_expands_short_match():
    selection = align_interval_to_target_duration(
        match_in_sec=10.0,
        match_out_sec=11.0,
        target_duration_sec=4.0,
        source_duration_sec=60.0,
    )
    assert selection.source_out_sec - selection.source_in_sec == pytest.approx(4.0, abs=0.11)
    assert "扩展" in selection.selection_reason


def test_apply_manual_trim_override():
    selection = apply_manual_trim_override(
        source_in_sec=3.0,
        source_out_sec=8.0,
        target_duration_sec=5.0,
        source_duration_sec=30.0,
    )
    assert selection.source_in_sec == pytest.approx(3.0)
    assert selection.source_out_sec == pytest.approx(8.0)


def test_pick_best_semantic_match():
    matches = [
        SimpleNamespace(match_score=0.4),
        SimpleNamespace(match_score=0.91),
        SimpleNamespace(match_score=0.7),
    ]
    best = pick_best_semantic_match(matches)
    assert best.match_score == pytest.approx(0.91)


def test_voiceover_broll_service_select_and_apply_mocked(tmp_path, monkeypatch):
    from backend.schemas.edit_session import (
        EditBlock,
        EditBlockMedia,
        EditBlockOverlay,
        EditBlockTrim,
        EditSessionUpdateRequest,
    )
    from backend.schemas.voiceover_plan import (
        VoiceoverApplyBrollRequest,
        VoiceoverBrollState,
        VoiceoverPlan,
        VoiceoverPlanStatus,
        VoiceoverSearchResult,
        VoiceoverSegment,
        VoiceoverSegmentStatus,
        VoiceoverTtsState,
    )
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_broll_service import VoiceoverBrollService
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_c"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()
    library_video = tmp_path / "broll.mp4"
    library_video.write_bytes(b"fake-video")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.resolve_library_video_path",
        lambda asset_id: library_video if asset_id == "lib-broll" else None,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.get_library_asset",
        lambda asset_id: {"id": asset_id, "title": "测试素材", "platform": "local"},
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.VideoProcessor.probe_video_duration_sec",
        lambda _path: 45.0,
    )

    fake_match = SimpleNamespace(
        trim_in_sec=8.0,
        trim_out_sec=20.0,
        match_score=0.88,
        match_reason="画面主体与描述一致",
    )

    monkeypatch.setattr(
        "backend.services.clip_event_detector.search_clip_events",
        lambda *_args, **_kwargs: ([fake_match], {"engine": "test"}),
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO C Test")
    block = EditBlock(
        id="block-vo-c",
        source_clip_id="import-test",
        title="占位",
        media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=5.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=5.0,
    )
    plan = VoiceoverPlan(
        id="vo-plan-c",
        status=VoiceoverPlanStatus.COMPLETED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-c1",
                index=1,
                narration_text="口播测试。",
                visual_brief="城市夜景航拍",
                search_queries=["city night drone"],
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(block_id=block.id),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(sequence=[block], voiceover_plan=plan),
    )

    vo_service = VoiceoverPlanService(session_service=session_service)

    monkeypatch.setattr(
        session_service,
        "probe_imported_block_duration",
        lambda *_args, **_kwargs: 45.0,
    )
    monkeypatch.setattr(
        session_service,
        "_prepare_import_video_source",
        lambda source, dest: (source, "reference"),
    )

    selected = VoiceoverSearchResult(
        platform="local",
        title="测试素材",
        url="",
        in_library=True,
        library_asset_id="lib-broll",
    )
    vo_service.broll_service.select_segment_material(
        project_id,
        created.id,
        "seg-c1",
        search_result=selected,
    )
    session, updated_plan, note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-c1",
        VoiceoverApplyBrollRequest(),
    )

    seg = updated_plan.segments[0]
    assert seg.status == VoiceoverSegmentStatus.BROLL_DONE
    assert seg.broll.source_out_sec - seg.broll.source_in_sec == pytest.approx(5.0, abs=0.11)
    assert "语义检索命中" in note
    assert len(session.sequence) == 1


def test_reconcile_broll_block_ids_from_timeline_titles():
    block = EditBlock(
        id="block-seg-4",
        source_clip_id="import-4",
        title=f"{BROLL_BLOCK_TITLE_PREFIX}4",
        media=EditBlockMedia(type="imported_clip", path="seg4.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=6.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=6.0,
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-4",
                index=4,
                narration_text="第四段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=6.0),
                broll=VoiceoverBrollState(selected=VoiceoverSearchResult(title="x", url="")),
            )
        ],
    )
    reconciled_plan, _, changed = VoiceoverBrollService._reconcile_broll_block_ids(
        SimpleNamespace(sequence=[block]),
        plan,
    )
    assert changed is True
    assert reconciled_plan.segments[0].broll.block_id == "block-seg-4"


def test_resolve_segment_timeline_start_from_plan():
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="一",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=4.0, timeline_start_sec=0.0),
            ),
            VoiceoverSegment(
                id="seg-2",
                index=2,
                narration_text="二",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=3.5),
            ),
            VoiceoverSegment(
                id="seg-5",
                index=5,
                narration_text="五",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=6.0, timeline_start_sec=18.0),
            ),
        ],
    )
    seg2 = plan.segments[1]
    seg5 = plan.segments[2]
    assert VoiceoverBrollService._resolve_segment_timeline_start(plan, seg5) == pytest.approx(18.0)
    assert VoiceoverBrollService._resolve_segment_timeline_start(plan, seg2) == pytest.approx(4.0)


def test_create_segment_video_block_uses_main_track_when_empty(monkeypatch, tmp_path):
    from backend.services.voiceover_broll_service import (
        DEFAULT_VIDEO_TRACK_ID,
        VoiceoverBrollService,
    )

    project_id = "proj_vo_align"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()
    library_video = tmp_path / "broll.mp4"
    library_video.write_bytes(b"fake-video")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.resolve_library_video_path",
        lambda asset_id: library_video if asset_id == "lib-broll" else None,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.VideoProcessor.probe_video_duration_sec",
        lambda _path: 30.0,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="align test")
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-4",
                index=4,
                narration_text="第四段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=12.0),
            ),
            VoiceoverSegment(
                id="seg-5",
                index=5,
                narration_text="第五段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=6.0, timeline_start_sec=17.0),
            ),
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
    )

    vo_service = VoiceoverBrollService(session_service=session_service)
    seg5 = plan.segments[1]
    session, block_id = vo_service._create_segment_video_block(
        project_id,
        created.id,
        plan,
        seg5,
        "lib-broll",
        target_duration_sec=6.0,
    )
    block = next(item for item in session.sequence if item.id == block_id)
    assert block.track_id == DEFAULT_VIDEO_TRACK_ID
    assert block.timeline_start_sec is None
    assert not any(
        track.id == "voiceover-broll" for track in (session.video_tracks or [])
    )


def test_create_segment_video_block_uses_overlay_when_main_has_content(monkeypatch, tmp_path):
    from backend.services.voiceover_broll_service import (
        VOICEOVER_BROLL_TRACK_ID,
        VoiceoverBrollService,
    )

    project_id = "proj_vo_overlay"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()
    library_video = tmp_path / "broll.mp4"
    library_video.write_bytes(b"fake-video")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.resolve_library_video_path",
        lambda asset_id: library_video if asset_id == "lib-broll" else None,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_broll_service.VideoProcessor.probe_video_duration_sec",
        lambda _path: 30.0,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="overlay test")
    main_block = EditBlock(
        id="main-import",
        source_clip_id="import-main",
        title="已有主轨素材",
        media=EditBlockMedia(type="imported_clip", path="main.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=10.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=10.0,
        track_id="default-video",
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="第一段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=6.0, timeline_start_sec=10.0),
            ),
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(sequence=[main_block], voiceover_plan=plan),
    )

    vo_service = VoiceoverBrollService(session_service=session_service)
    session, block_id = vo_service._create_segment_video_block(
        project_id,
        created.id,
        plan,
        plan.segments[0],
        "lib-broll",
        target_duration_sec=6.0,
    )
    block = next(item for item in session.sequence if item.id == block_id)
    assert block.track_id == VOICEOVER_BROLL_TRACK_ID
    assert block.timeline_start_sec == pytest.approx(10.0)
    assert any(track.id == VOICEOVER_BROLL_TRACK_ID for track in (session.video_tracks or []))

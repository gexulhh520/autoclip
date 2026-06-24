"""口播里程碑 C 单元测试。"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.services.material_download_service import format_material_download_error
from backend.services.voiceover_broll_service import VoiceoverBrollService

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

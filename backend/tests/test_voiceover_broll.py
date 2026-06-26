"""口播里程碑 C 单元测试。"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.schemas.edit_session import (
    AudioClipElement,
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
from backend.services.material_download_service import format_material_download_error
from backend.services.edit_session_service import EditSessionService
from backend.services.voiceover_broll_service import BROLL_BLOCK_TITLE_PREFIX, VoiceoverBrollService
from backend.services.voiceover_track_placement import (
    VOICEOVER_BROLL_TRACK_ID,
    VOICEOVER_PLACEHOLDER_TITLE_PREFIX,
    resolve_segment_video_block_id,
)

from backend.services.voiceover_broll_selection import (
    align_interval_to_target_duration,
    apply_manual_trim_override,
    build_broll_search_criteria,
    fallback_broll_trim_selection,
    normalize_broll_block_trim_for_timeline,
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
    exact = apply_manual_trim_override(
        source_in_sec=3.0,
        source_out_sec=8.0,
        target_duration_sec=5.0,
        source_duration_sec=30.0,
    )
    assert exact.source_in_sec == pytest.approx(3.0)
    assert exact.source_out_sec == pytest.approx(8.0)
    assert exact.source_out_sec - exact.source_in_sec == pytest.approx(5.0, abs=0.01)

    long_sel = apply_manual_trim_override(
        source_in_sec=3.0,
        source_out_sec=30.0,
        target_duration_sec=5.0,
        source_duration_sec=30.0,
    )
    assert long_sel.source_in_sec == pytest.approx(3.0)
    assert long_sel.source_out_sec == pytest.approx(8.0)
    assert "对齐" in long_sel.selection_reason

    out_anchor = apply_manual_trim_override(
        source_in_sec=3.0,
        source_out_sec=30.0,
        target_duration_sec=5.0,
        source_duration_sec=30.0,
        trim_anchor="out",
    )
    assert out_anchor.source_in_sec == pytest.approx(25.0)
    assert out_anchor.source_out_sec == pytest.approx(30.0)

    # block.duration_sec 可能仅为口播时长，不能据此 clamp 用户选段
    short_probe = apply_manual_trim_override(
        source_in_sec=30.0,
        source_out_sec=35.0,
        target_duration_sec=5.0,
        source_duration_sec=5.0,
    )
    assert short_probe.source_in_sec == pytest.approx(30.0)
    assert short_probe.source_out_sec == pytest.approx(35.0)


def test_normalize_broll_block_trim_for_timeline():
    trim_in, trim_out, duration, media = normalize_broll_block_trim_for_timeline(
        30.0,
        35.0,
        5.0,
        {"type": "imported_clip", "path": "clip.mp4"},
    )
    assert trim_in == pytest.approx(0.0)
    assert trim_out == pytest.approx(5.0)
    assert duration == pytest.approx(5.0)
    assert media["source_start_sec"] == pytest.approx(30.0)

    trim_in, trim_out, duration, media = normalize_broll_block_trim_for_timeline(
        0.0,
        5.0,
        5.0,
        media,
    )
    assert trim_in == pytest.approx(0.0)
    assert "source_start_sec" not in media


def test_pick_best_semantic_match():
    matches = [
        SimpleNamespace(match_score=0.4),
        SimpleNamespace(match_score=0.91),
        SimpleNamespace(match_score=0.7),
    ]
    best = pick_best_semantic_match(matches)
    assert best.match_score == pytest.approx(0.91)


def test_fallback_broll_trim_selection_uses_source_start():
    selection = fallback_broll_trim_selection(
        target_duration_sec=17.71,
        source_duration_sec=120.0,
        criteria="慢镜头特写梅西",
    )
    assert selection.source_in_sec == pytest.approx(0.0)
    assert selection.source_out_sec == pytest.approx(17.71, abs=0.01)
    assert "素材开头" in selection.selection_reason


def test_semantic_select_trim_falls_back_when_no_matches(monkeypatch, tmp_path):
    project_id = "proj_vo_fallback"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.clip_event_detector.search_clip_events",
        lambda *_args, **_kwargs: ([], {"engine": "clip_collage_coarse_fine_v2"}),
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="fallback test")
    block = EditBlock(
        id="block-fallback",
        source_clip_id="import-fallback",
        title="口播素材-1",
        media=EditBlockMedia(type="imported_clip", path="clip.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=120.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=120.0,
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(sequence=[block]),
    )

    vo_service = VoiceoverBrollService(session_service=session_service)
    segment = VoiceoverSegment(
        id="seg-1",
        index=1,
        narration_text="口播",
        visual_brief="梅西特写",
        status=VoiceoverSegmentStatus.TTS_DONE,
        tts=VoiceoverTtsState(duration_sec=17.71),
    )
    selection = vo_service._semantic_select_trim(
        project_id,
        created.id,
        block.id,
        segment=segment,
        source_duration_sec=120.0,
        target_duration_sec=17.71,
    )
    assert selection.source_out_sec - selection.source_in_sec == pytest.approx(17.71, abs=0.01)
    assert "素材开头" in selection.selection_reason


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
    assert len(session.sequence) == 2
    assert block.id in {item.id for item in session.sequence}
    assert seg.broll.block_id != block.id


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


def test_reconcile_broll_block_ids_clears_stale_block_reference():
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="第一段",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(
                    block_id="ce56c262-f63c-49df-bdfa-1020d66f8656",
                    library_asset_id="lib-old",
                    source_in_sec=0.0,
                    source_out_sec=5.0,
                    selected=VoiceoverSearchResult(title="旧素材", url=""),
                ),
            )
        ],
    )
    reconciled_plan, _, changed = VoiceoverBrollService._reconcile_broll_block_ids(
        SimpleNamespace(sequence=[]),
        plan,
    )
    assert changed is True
    seg = reconciled_plan.segments[0]
    assert seg.broll.block_id == ""
    assert seg.status == VoiceoverSegmentStatus.TTS_DONE
    assert seg.broll.selected is not None
    assert seg.broll.library_asset_id == "lib-old"


def test_apply_segment_broll_recreates_block_after_timeline_delete(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_reapply"
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
        trim_in_sec=1.0,
        trim_out_sec=6.0,
        match_score=0.9,
        match_reason="画面匹配",
    )
    monkeypatch.setattr(
        "backend.services.clip_event_detector.search_clip_events",
        lambda *_args, **_kwargs: ([fake_match], {"engine": "test"}),
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="reapply test")
    stale_block_id = "ce56c262-f63c-49df-bdfa-1020d66f8656"
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.COMPLETED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播测试。",
                visual_brief="城市夜景",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(
                    block_id=stale_block_id,
                    selected=VoiceoverSearchResult(
                        platform="local",
                        title="测试素材",
                        url="",
                        in_library=True,
                        library_asset_id="lib-broll",
                    ),
                ),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(sequence=[], voiceover_plan=plan),
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

    session, updated_plan, note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-1",
        VoiceoverApplyBrollRequest(),
    )

    seg = updated_plan.segments[0]
    assert seg.status == VoiceoverSegmentStatus.BROLL_DONE
    assert seg.broll.block_id
    assert seg.broll.block_id != stale_block_id
    assert len(session.sequence) == 1
    assert "画面匹配" in note


def test_apply_manual_broll_without_prior_select(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_manual_pick"
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

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="manual pick")
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.CONFIRMED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播测试。",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(selected=None),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
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

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-1",
        VoiceoverApplyBrollRequest(
            source_in_sec=2.0,
            source_out_sec=10.0,
            library_asset_id="lib-broll",
        ),
    )

    seg = updated_plan.segments[0]
    assert seg.status == VoiceoverSegmentStatus.BROLL_DONE
    assert seg.broll.selected is not None
    assert seg.broll.block_id
    assert len(session.sequence) == 1
    block = session.sequence[0]
    assert block.duration_sec == pytest.approx(5.0, abs=0.05)
    assert block.trim.in_sec == pytest.approx(0.0)
    assert block.trim.out_sec - block.trim.in_sec == pytest.approx(5.0, abs=0.05)
    assert block.media.source_start_sec == pytest.approx(2.0, abs=0.05)
    assert seg.broll.source_in_sec == pytest.approx(2.0, abs=0.05)
    assert block.track_id == VOICEOVER_BROLL_TRACK_ID
    assert block.timeline_start_sec == pytest.approx(0.0)


def test_apply_manual_broll_aligns_overlay_to_audio_clip(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_manual_align"
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
        lambda _path: 120.0,
    )

    audio = AudioClipElement(
        id="vo-audio-2",
        asset_id="tts-2",
        start_sec=5.0,
        duration_sec=4.0,
    )
    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="manual align")
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.CONFIRMED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-2",
                index=2,
                narration_text="第二段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(
                    duration_sec=4.0,
                    timeline_start_sec=99.0,
                    audio_clip_id=audio.id,
                ),
                broll=VoiceoverBrollState(
                    selected=VoiceoverSearchResult(
                        platform="local",
                        title="测试素材",
                        url="",
                        in_library=True,
                        library_asset_id="lib-broll",
                    )
                ),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(audio_elements=[audio], voiceover_plan=plan),
    )

    vo_service = VoiceoverPlanService(session_service=session_service)
    monkeypatch.setattr(
        session_service,
        "probe_imported_block_duration",
        lambda *_args, **_kwargs: 120.0,
    )
    monkeypatch.setattr(
        session_service,
        "_prepare_import_video_source",
        lambda source, dest: (source, "reference"),
    )

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-2",
        VoiceoverApplyBrollRequest(
            source_in_sec=30.0,
            source_out_sec=40.0,
        ),
    )

    block = next(item for item in session.sequence if item.id == updated_plan.segments[0].broll.block_id)
    assert block.track_id == VOICEOVER_BROLL_TRACK_ID
    assert block.timeline_start_sec == pytest.approx(5.0)
    assert block.media.source_start_sec == pytest.approx(30.0)
    assert block.trim.in_sec == pytest.approx(0.0)
    assert block.duration_sec == pytest.approx(4.0, abs=0.05)


def test_apply_manual_broll_respects_trim_when_block_duration_is_tts_length(monkeypatch, tmp_path):
    """创建 block 后 duration_sec 仅为口播时长，不能误当作素材全长 clamp 用户选段。"""
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_manual_probe"
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
        lambda _path: 120.0,
    )

    audio = AudioClipElement(
        id="vo-audio-probe",
        asset_id="tts-probe",
        start_sec=2.0,
        duration_sec=5.0,
    )
    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="manual probe")
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.CONFIRMED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-probe",
                index=1,
                narration_text="测试",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(
                    duration_sec=5.0,
                    timeline_start_sec=2.0,
                    audio_clip_id=audio.id,
                ),
                broll=VoiceoverBrollState(
                    selected=VoiceoverSearchResult(
                        platform="local",
                        title="测试素材",
                        url="",
                        in_library=True,
                        library_asset_id="lib-broll",
                    )
                ),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(audio_elements=[audio], voiceover_plan=plan),
    )

    vo_service = VoiceoverPlanService(session_service=session_service)
    monkeypatch.setattr(
        session_service,
        "probe_imported_block_duration",
        lambda *_args, **_kwargs: 5.0,
    )
    monkeypatch.setattr(
        session_service,
        "_prepare_import_video_source",
        lambda source, dest: (source, "reference"),
    )

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-probe",
        VoiceoverApplyBrollRequest(
            source_in_sec=30.0,
            source_out_sec=35.0,
        ),
    )

    block = next(item for item in session.sequence if item.id == updated_plan.segments[0].broll.block_id)
    assert block.media.source_start_sec == pytest.approx(30.0)
    assert block.duration_sec == pytest.approx(5.0, abs=0.05)
    assert updated_plan.segments[0].broll.source_in_sec == pytest.approx(30.0)
    assert updated_plan.segments[0].broll.source_out_sec == pytest.approx(35.0)


def test_apply_manual_broll_library_asset_id_overrides_stale_selected(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_manual_override"
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

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="manual override")
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.CONFIRMED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播测试。",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(
                    selected=VoiceoverSearchResult(
                        platform="web",
                        title="旧候选",
                        url="https://example.com/old.mp4",
                    )
                ),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
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

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-1",
        VoiceoverApplyBrollRequest(
            source_in_sec=1.0,
            source_out_sec=8.0,
            library_asset_id="lib-broll",
        ),
    )

    seg = updated_plan.segments[0]
    assert seg.broll.selected is not None
    assert seg.broll.selected.library_asset_id == "lib-broll"
    assert seg.broll.block_id
    assert len(session.sequence) == 1


def test_resolve_segment_video_block_id_from_audio_linked_placeholder():
    placeholder_id = "block-placeholder"
    placeholder = EditBlock(
        id=placeholder_id,
        source_clip_id="import-ph",
        title=f"{VOICEOVER_PLACEHOLDER_TITLE_PREFIX}abc12345",
        media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=5.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=5.0,
    )
    audio_clip = AudioClipElement(
        id="vo-audio-1",
        asset_id="tts-1",
        start_sec=0.0,
        duration_sec=5.0,
        block_id=placeholder_id,
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, audio_clip_id=audio_clip.id),
                broll=VoiceoverBrollState(),
            )
        ],
    )
    session = SimpleNamespace(sequence=[placeholder], audio_elements=[audio_clip])
    assert resolve_segment_video_block_id(session, plan, plan.segments[0]) == placeholder_id


def test_apply_segment_broll_keeps_other_segment_blocks_on_reapply(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_multi_seg"
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
        trim_in_sec=1.0,
        trim_out_sec=6.0,
        match_score=0.9,
        match_reason="画面匹配",
    )
    monkeypatch.setattr(
        "backend.services.clip_event_detector.search_clip_events",
        lambda *_args, **_kwargs: ([fake_match], {"engine": "test"}),
    )

    block_seg1 = EditBlock(
        id="block-seg-1",
        source_clip_id="import-1",
        title=f"{BROLL_BLOCK_TITLE_PREFIX}1",
        media=EditBlockMedia(type="imported_clip", path="seg1.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=5.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=5.0,
    )
    block_seg2 = EditBlock(
        id="block-seg-2",
        source_clip_id="import-2",
        title=f"{BROLL_BLOCK_TITLE_PREFIX}2",
        media=EditBlockMedia(type="imported_clip", path="seg2.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=4.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=4.0,
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.COMPLETED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="第一段。",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(
                    block_id=block_seg1.id,
                    library_asset_id="lib-broll",
                    source_in_sec=0.0,
                    source_out_sec=5.0,
                    selected=VoiceoverSearchResult(title="素材1", url=""),
                ),
            ),
            VoiceoverSegment(
                id="seg-2",
                index=2,
                narration_text="第二段。",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(duration_sec=4.0, timeline_start_sec=5.0),
                broll=VoiceoverBrollState(
                    block_id=block_seg2.id,
                    library_asset_id="lib-broll",
                    source_in_sec=1.0,
                    source_out_sec=5.0,
                    selected=VoiceoverSearchResult(
                        title="素材2",
                        url="",
                        in_library=True,
                        library_asset_id="lib-broll",
                    ),
                ),
            ),
        ],
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="multi seg")
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(sequence=[block_seg1, block_seg2], voiceover_plan=plan),
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

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-2",
        VoiceoverApplyBrollRequest(),
    )

    assert len(session.sequence) == 3
    assert {block.id for block in session.sequence} == {
        block_seg1.id,
        block_seg2.id,
        updated_plan.segments[1].broll.block_id,
    }
    seg2 = next(item for item in updated_plan.segments if item.id == "seg-2")
    assert seg2.broll.block_id != block_seg2.id
    assert seg2.broll.source_out_sec - seg2.broll.source_in_sec == pytest.approx(4.0, abs=0.05)


def test_apply_segment_broll_keeps_orphan_placeholder_on_reapply(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_orphan_ph"
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
        trim_in_sec=1.0,
        trim_out_sec=6.0,
        match_score=0.9,
        match_reason="画面匹配",
    )
    monkeypatch.setattr(
        "backend.services.clip_event_detector.search_clip_events",
        lambda *_args, **_kwargs: ([fake_match], {"engine": "test"}),
    )

    placeholder_id = "block-placeholder"
    duplicate_id = "block-dup-broll"
    placeholder = EditBlock(
        id=placeholder_id,
        source_clip_id="import-ph",
        title=f"{VOICEOVER_PLACEHOLDER_TITLE_PREFIX}abc12345",
        media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=5.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=5.0,
    )
    duplicate = EditBlock(
        id=duplicate_id,
        source_clip_id="import-dup",
        title=f"{BROLL_BLOCK_TITLE_PREFIX}1",
        media=EditBlockMedia(type="imported_clip", path="dup.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=5.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=5.0,
    )
    audio_clip = AudioClipElement(
        id="vo-audio-1",
        asset_id="tts-1",
        start_sec=0.0,
        duration_sec=5.0,
        block_id=placeholder_id,
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.COMPLETED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播测试。",
                visual_brief="城市夜景",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(
                    duration_sec=5.0,
                    timeline_start_sec=0.0,
                    audio_clip_id=audio_clip.id,
                ),
                broll=VoiceoverBrollState(
                    block_id=duplicate_id,
                    selected=VoiceoverSearchResult(
                        platform="local",
                        title="测试素材",
                        url="",
                        in_library=True,
                        library_asset_id="lib-broll",
                    ),
                ),
            )
        ],
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="orphan placeholder")
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(
            sequence=[placeholder, duplicate],
            audio_elements=[audio_clip],
            voiceover_plan=plan,
        ),
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

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-1",
        VoiceoverApplyBrollRequest(),
    )

    assert len(session.sequence) == 3
    assert {block.id for block in session.sequence} == {
        placeholder_id,
        duplicate_id,
        updated_plan.segments[0].broll.block_id,
    }
    assert updated_plan.segments[0].broll.block_id != duplicate_id


def test_apply_segment_broll_creates_new_block_when_plan_block_id_missing(monkeypatch, tmp_path):
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo_reuse_ph"
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
        trim_in_sec=1.0,
        trim_out_sec=6.0,
        match_score=0.9,
        match_reason="画面匹配",
    )
    monkeypatch.setattr(
        "backend.services.clip_event_detector.search_clip_events",
        lambda *_args, **_kwargs: ([fake_match], {"engine": "test"}),
    )

    placeholder_id = "block-placeholder"
    placeholder = EditBlock(
        id=placeholder_id,
        source_clip_id="import-ph",
        title=f"{VOICEOVER_PLACEHOLDER_TITLE_PREFIX}abc12345",
        media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=5.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=5.0,
    )
    audio_clip = AudioClipElement(
        id="vo-audio-1",
        asset_id="tts-1",
        start_sec=0.0,
        duration_sec=5.0,
        block_id=placeholder_id,
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        status=VoiceoverPlanStatus.COMPLETED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播测试。",
                visual_brief="城市夜景",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(
                    duration_sec=5.0,
                    timeline_start_sec=0.0,
                    audio_clip_id=audio_clip.id,
                ),
                broll=VoiceoverBrollState(
                    selected=VoiceoverSearchResult(
                        platform="local",
                        title="测试素材",
                        url="",
                        in_library=True,
                        library_asset_id="lib-broll",
                    ),
                ),
            )
        ],
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="reuse placeholder")
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(
            sequence=[placeholder],
            audio_elements=[audio_clip],
            voiceover_plan=plan,
        ),
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

    session, updated_plan, _note = vo_service.apply_segment_broll(
        project_id,
        created.id,
        "seg-1",
        VoiceoverApplyBrollRequest(),
    )

    assert len(session.sequence) == 2
    assert placeholder_id in {block.id for block in session.sequence}
    assert updated_plan.segments[0].broll.block_id != placeholder_id
    assert updated_plan.segments[0].broll.block_id


def test_resolve_segment_timeline_start_from_plan():
    from types import SimpleNamespace

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
    empty_session = SimpleNamespace(audio_elements=[])
    assert VoiceoverBrollService._resolve_segment_timeline_start(empty_session, plan, seg5) == pytest.approx(18.0)
    assert VoiceoverBrollService._resolve_segment_timeline_start(empty_session, plan, seg2) == pytest.approx(4.0)


def test_resolve_segment_timeline_start_prefers_audio_clip():
    from types import SimpleNamespace

    audio = AudioClipElement(
        id="vo-audio-2",
        asset_id="tts-2",
        start_sec=5.25,
        duration_sec=4.0,
    )
    session = SimpleNamespace(audio_elements=[audio])
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-2",
                index=2,
                narration_text="二",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(
                    duration_sec=4.0,
                    timeline_start_sec=99.0,
                    audio_clip_id=audio.id,
                ),
            ),
        ],
    )
    seg = plan.segments[0]
    assert VoiceoverBrollService._resolve_segment_timeline_start(session, plan, seg) == pytest.approx(5.25)


def test_create_segment_video_block_uses_overlay_aligned_to_audio(monkeypatch, tmp_path):
    from backend.services.voiceover_broll_service import (
        VOICEOVER_BROLL_TRACK_ID,
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
                id="seg-1",
                index=1,
                narration_text="第一段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=5.0, timeline_start_sec=0.0),
            ),
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
    )

    vo_service = VoiceoverBrollService(session_service=session_service)
    session, block_id = vo_service._create_segment_video_block(
        project_id,
        created.id,
        plan,
        plan.segments[0],
        "lib-broll",
        target_duration_sec=5.0,
    )
    block = next(item for item in session.sequence if item.id == block_id)
    assert block.track_id == VOICEOVER_BROLL_TRACK_ID
    assert block.timeline_start_sec == pytest.approx(0.0)
    assert any(track.id == VOICEOVER_BROLL_TRACK_ID for track in (session.video_tracks or []))


def test_create_segment_video_block_uses_overlay_when_audio_not_at_zero(monkeypatch, tmp_path):
    from backend.services.voiceover_broll_service import (
        VOICEOVER_BROLL_TRACK_ID,
        VoiceoverBrollService,
    )

    project_id = "proj_vo_align_late"
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
    created = session_service.create_blank_session(project_id, name="align late test")
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
    assert block.track_id == VOICEOVER_BROLL_TRACK_ID
    assert block.timeline_start_sec == pytest.approx(17.0)
    assert any(track.id == VOICEOVER_BROLL_TRACK_ID for track in (session.video_tracks or []))


def test_create_segment_video_block_appends_main_when_audio_after_existing_clip(
    monkeypatch, tmp_path
):
    from backend.services.voiceover_broll_service import (
        DEFAULT_VIDEO_TRACK_ID,
        VoiceoverBrollService,
    )

    project_id = "proj_vo_append_main"
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
    created = session_service.create_blank_session(project_id, name="append main test")
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
    main_blocks = [item for item in session.sequence if item.track_id == DEFAULT_VIDEO_TRACK_ID]
    assert [item.id for item in main_blocks] == [main_block.id]


def test_create_segment_video_block_uses_overlay_when_main_overlaps_audio_window(
    monkeypatch, tmp_path
):
    from backend.services.voiceover_broll_service import (
        VOICEOVER_BROLL_TRACK_ID,
        VoiceoverBrollService,
    )

    project_id = "proj_vo_overlap"
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
    created = session_service.create_blank_session(project_id, name="overlap test")
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
                tts=VoiceoverTtsState(duration_sec=6.0, timeline_start_sec=6.0),
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
    assert block.timeline_start_sec == pytest.approx(6.0)
    assert any(track.id == VOICEOVER_BROLL_TRACK_ID for track in (session.video_tracks or []))


def test_create_segment_video_block_second_segment_uses_main_after_first_on_main(
    monkeypatch, tmp_path
):
    from backend.services.voiceover_broll_service import (
        BROLL_BLOCK_TITLE_PREFIX,
        DEFAULT_VIDEO_TRACK_ID,
        VoiceoverBrollService,
    )

    project_id = "proj_vo_seg2_main"
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
    created = session_service.create_blank_session(project_id, name="seg2 main")
    seg1_block = EditBlock(
        id="block-seg-1",
        source_clip_id="import-1",
        title=f"{BROLL_BLOCK_TITLE_PREFIX}1",
        media=EditBlockMedia(type="imported_clip", path="seg1.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=4.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=4.0,
        track_id=DEFAULT_VIDEO_TRACK_ID,
    )
    plan = VoiceoverPlan(
        id="vo-plan",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="第一段",
                status=VoiceoverSegmentStatus.BROLL_DONE,
                tts=VoiceoverTtsState(duration_sec=4.0, timeline_start_sec=0.0),
                broll=VoiceoverBrollState(block_id=seg1_block.id),
            ),
            VoiceoverSegment(
                id="seg-2",
                index=2,
                narration_text="第二段",
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(duration_sec=3.5, timeline_start_sec=4.0),
            ),
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(sequence=[seg1_block], voiceover_plan=plan),
    )

    vo_service = VoiceoverBrollService(session_service=session_service)
    session, block_id = vo_service._create_segment_video_block(
        project_id,
        created.id,
        plan,
        plan.segments[1],
        "lib-broll",
        target_duration_sec=3.5,
    )
    block = next(item for item in session.sequence if item.id == block_id)
    assert block.track_id == VOICEOVER_BROLL_TRACK_ID
    assert block.timeline_start_sec == pytest.approx(4.0)
    main_blocks = [item for item in session.sequence if item.track_id == DEFAULT_VIDEO_TRACK_ID]
    assert [item.id for item in main_blocks] == [seg1_block.id]


def test_should_insert_on_main_false_when_audio_window_overlaps_main_video():
    from backend.services.voiceover_track_placement import (
        should_insert_voiceover_broll_on_main_track,
    )

    session = SimpleNamespace(
        sequence=[
            EditBlock(
                id="main-1",
                source_clip_id="main-1",
                title="已有素材",
                media=EditBlockMedia(type="imported_clip", path="main.mp4"),
                trim=EditBlockTrim(in_sec=0.0, out_sec=10.0),
                overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
                duration_sec=10.0,
                track_id="default-video",
            )
        ],
        audio_settings=SimpleNamespace(transition_duration_sec=0.35),
    )
    assert (
        should_insert_voiceover_broll_on_main_track(
            session,
            audio_timeline_start_sec=6.0,
            audio_timeline_end_sec=9.0,
        )
        is False
    )


def test_should_insert_on_main_false_when_gap_before_audio_start():
    from backend.services.voiceover_track_placement import (
        should_insert_voiceover_broll_on_main_track,
    )

    session = SimpleNamespace(
        sequence=[],
        audio_settings=SimpleNamespace(transition_duration_sec=0.35),
    )
    assert (
        should_insert_voiceover_broll_on_main_track(
            session,
            audio_timeline_start_sec=12.0,
            audio_timeline_end_sec=17.0,
        )
        is False
    )

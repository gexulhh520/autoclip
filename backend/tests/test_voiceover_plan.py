"""口播 plan 里程碑 A 单元测试。"""
from backend.schemas.voiceover_plan import (
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
)
from backend.services.voiceover_script_generator import _parse_segments


def test_parse_segments_from_llm_json():
    raw = {
        "segments": [
            {
                "narration_text": "第一段口播文案。",
                "visual_brief": "产品特写，桌面俯拍",
                "search_queries": ["product b-roll", "desk top view"],
            },
            {
                "narration_text": "第二段口播文案。",
                "visual_brief": "用户使用手机",
                "search_queries": ["phone usage"],
            },
        ]
    }
    segments = _parse_segments(raw)
    assert len(segments) == 2
    assert segments[0].index == 1
    assert segments[1].index == 2
    assert segments[0].search_queries[0] == "product b-roll"


def test_voiceover_generate_response_model_rebuilt():
    from backend.schemas.edit_session import EditSession
    from backend.schemas.voiceover_plan import (
        VoiceoverGenerateResponse,
        VoiceoverPlan,
        VoiceoverSegment,
    )

    session = EditSession(
        id="sess",
        project_id="proj",
        created_at="",
        updated_at="",
    )
    plan = VoiceoverPlan(
        id="plan-1",
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="口播文案",
            )
        ],
    )
    response = VoiceoverGenerateResponse(session=session, plan=plan, note="ok")
    assert response.note == "ok"
    assert response.session.id == "sess"


def test_voiceover_plan_service_confirm_requires_text(tmp_path, monkeypatch):
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "proj_vo"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO Test")
    vo_service = VoiceoverPlanService(session_service=session_service)

    plan = VoiceoverPlan(
        id="vo-plan-test",
        status=VoiceoverPlanStatus.DRAFT,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="有效口播",
                visual_brief="画面",
                search_queries=["test"],
            )
        ],
    )
    from backend.schemas.edit_session import EditSessionUpdateRequest

    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
    )

    updated = vo_service.confirm_plan(project_id, created.id)
    assert updated.voiceover_plan is not None
    assert updated.voiceover_plan.status == VoiceoverPlanStatus.CONFIRMED
    assert updated.voiceover_plan.segments[0].status == VoiceoverSegmentStatus.SCRIPT_CONFIRMED

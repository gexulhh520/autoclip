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


def test_generate_plan_returns_existing_draft_without_replace(tmp_path, monkeypatch):
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_plan_service import VoiceoverPlanService
    from backend.schemas.voiceover_plan import VoiceoverGenerateRequest

    project_id = "proj_vo_draft"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO Draft")
    vo_service = VoiceoverPlanService(session_service=session_service)

    plan = VoiceoverPlan(
        id="vo-plan-draft",
        status=VoiceoverPlanStatus.DRAFT,
        user_brief="已有草稿",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="已有口播",
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

    session, returned, note = vo_service.generate_plan(
        project_id,
        created.id,
        VoiceoverGenerateRequest(user_brief="新意图", replace_existing=False),
    )
    assert returned.id == "vo-plan-draft"
    assert "已有口播草稿" in note
    assert session.voiceover_plan is not None


def test_translate_search_queries_uses_llm():
    from backend.services.voiceover_script_generator import translate_search_queries

    class _FakeLlm:
        def complete_messages(self, messages, **kwargs):
            class _Resp:
                content = '{"queries": ["城市夜景航拍", "办公室打字"]}'

            return _Resp()

        def parse_json_response(self, content):
            import json

            return json.loads(content)

    translated = translate_search_queries(
        _FakeLlm(),
        ["city night drone", "office desk typing"],
        "zh",
    )
    assert translated == ["城市夜景航拍", "办公室打字"]


def test_update_segment_search_queries_after_confirm(tmp_path, monkeypatch):
    from backend.schemas.voiceover_plan import (
        VoiceoverGenerateRequest,
        VoiceoverUpdateSegmentSearchQueriesRequest,
    )
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_plan_service import VoiceoverPlanService

    project_id = "vo-search-query-edit"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir(parents=True)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO")
    vo_service = VoiceoverPlanService(session_service)

    class _FakeLlm:
        def complete_messages(self, messages, **kwargs):
            class _Resp:
                content = (
                    '{"segments": [{"narration_text": "测试口播", "visual_brief": "画面", '
                    '"search_queries": ["city night"]}]}'
                )

            return _Resp()

        def parse_json_response(self, content):
            import json

            return json.loads(content)

    monkeypatch.setattr(
        "backend.services.voiceover_plan_service.get_llm_manager",
        lambda: _FakeLlm(),
    )

    vo_service.generate_plan(
        project_id,
        created.id,
        VoiceoverGenerateRequest(user_brief="测试意图"),
    )
    vo_service.confirm_plan(project_id, created.id)

    segment_id = vo_service.get_plan(project_id, created.id)[1].segments[0].id
    updated = vo_service.update_segment_search_queries(
        project_id,
        created.id,
        segment_id,
        VoiceoverUpdateSegmentSearchQueriesRequest(
            search_queries=["tokyo street night", "neon lights"]
        ),
    )
    assert updated.voiceover_plan.segments[0].search_queries == [
        "tokyo street night",
        "neon lights",
    ]

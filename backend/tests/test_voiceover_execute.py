"""口播里程碑 B 单元测试。"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend.schemas.voiceover_plan import (
    VoiceoverExecuteRequest,
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
)
from backend.services.voiceover_orchestrator import VoiceoverOrchestrator
from backend.utils.edge_tts_service import (
    MAX_SUBTITLE_DISPLAY_CHARS,
    SubtitleCueTiming,
    normalize_text_for_tts,
    refine_subtitle_cues,
    split_oversized_display_cues,
    synthesize_with_timings,
)


def test_normalize_text_for_tts_replaces_commas():
    assert normalize_text_for_tts("你好，世界、测试") == "你好。世界。测试"
    assert normalize_text_for_tts("  hello, world  ") == "hello。 world"


def test_refine_subtitle_cues_uses_tts_boundaries_directly():
    boundaries = [
        SubtitleCueTiming(
            text="第一句很长。",
            start_sec=0.1,
            end_sec=1.5,
            boundary_type="SentenceBoundary",
        ),
        SubtitleCueTiming(
            text="第二句也很长。",
            start_sec=1.5,
            end_sec=3.0,
            boundary_type="SentenceBoundary",
        ),
    ]
    sentence_cues, word_timings = refine_subtitle_cues(boundaries, "")
    assert len(sentence_cues) == 2
    assert sentence_cues[0].text.startswith("第一句")
    assert sentence_cues[1].text.startswith("第二句")
    assert word_timings
    assert word_timings[0].end_sec > word_timings[0].start_sec


def test_refine_subtitle_cues_keeps_single_boundary_without_comma_split():
    long_line = (
        "在影片中，李连杰饰演的角色并非简单的武林高手，"
        "而是一个在复杂政治漩涡中挣扎的孤独灵魂。"
    )
    boundaries = [
        SubtitleCueTiming(
            text=long_line,
            start_sec=0.0,
            end_sec=8.0,
            boundary_type="SentenceBoundary",
        )
    ]
    sentence_cues, _word_timings = refine_subtitle_cues(boundaries, long_line)
    assert len(sentence_cues) == 1
    assert sentence_cues[0].text == long_line
    assert sentence_cues[0].start_sec == pytest.approx(0.0)
    assert sentence_cues[0].end_sec == pytest.approx(8.0)


def test_split_oversized_display_cues_by_symbol_recursive():
    long_line = (
        "在影片中，李连杰饰演的角色并非简单的武林高手，"
        "而是一个在复杂政治漩涡中挣扎的孤独灵魂。"
    )
    cue = SubtitleCueTiming(text=long_line, start_sec=0.0, end_sec=8.0)
    display_cues = split_oversized_display_cues([cue], max_chars=MAX_SUBTITLE_DISPLAY_CHARS)
    assert len(display_cues) >= 3
    joined = "".join(item.text for item in display_cues)
    assert "李连杰" in joined
    assert "孤独灵魂" in joined
    for item in display_cues:
        assert _visible_chars(item.text) <= MAX_SUBTITLE_DISPLAY_CHARS, item.text
    assert display_cues[0].start_sec == pytest.approx(0.0)
    assert display_cues[-1].end_sec == pytest.approx(8.0)


def _visible_chars(text: str) -> int:
    return len(text.replace(" ", ""))


def test_build_voiceover_overlays_splits_long_sentence_for_display():
    from backend.schemas.edit_session import EditSession
    from backend.services.voiceover_subtitle_builder import build_voiceover_overlays

    session = EditSession(
        id="sess",
        project_id="proj",
        created_at="",
        updated_at="",
    )
    long_line = "很多人以为剪辑只是剪片段，其实节奏和口播才是留住观众的关键所在。"
    cues = [SubtitleCueTiming(text=long_line, start_sec=0.0, end_sec=4.0)]
    overlays = build_voiceover_overlays(
        cues,
        session=session,
        block_id="block-1",
        block_timeline_start_sec=5.0,
    )
    assert len(overlays) >= 2
    assert overlays[0].start_sec == pytest.approx(5.0)
    assert overlays[-1].start_sec + overlays[-1].duration_sec == pytest.approx(9.0)


def test_build_voiceover_overlays_multiple_cues():
    from backend.schemas.edit_session import EditSession
    from backend.services.voiceover_subtitle_builder import build_voiceover_overlays

    session = EditSession(
        id="sess",
        project_id="proj",
        created_at="",
        updated_at="",
    )
    cues = [
        SubtitleCueTiming(text="你好。", start_sec=0.0, end_sec=1.0),
        SubtitleCueTiming(text="世界。", start_sec=1.0, end_sec=2.0),
    ]
    overlays = build_voiceover_overlays(
        cues,
        session=session,
        block_id="block-1",
        block_timeline_start_sec=5.0,
    )
    assert len(overlays) == 2
    assert overlays[0].start_sec == pytest.approx(5.0)
    assert overlays[1].start_sec == pytest.approx(6.0)
    assert overlays[0].params["timeline.blockId"] == "block-1"


def test_synthesize_with_timings_writes_file(tmp_path: Path):
    output = tmp_path / "tts.mp3"
    result = asyncio.run(synthesize_with_timings("你好，这是测试。", output))
    assert output.exists()
    assert output.stat().st_size > 0
    assert result.duration_sec > 0
    assert len(result.cues) >= 1


def test_build_voiceover_overlays_without_block_link():
    from backend.schemas.edit_session import EditSession
    from backend.services.voiceover_subtitle_builder import (
        TIMELINE_BLOCK_ID_PARAM,
        build_voiceover_overlays,
    )

    session = EditSession(
        id="sess",
        project_id="proj",
        created_at="",
        updated_at="",
    )
    cues = [SubtitleCueTiming(text="你好。", start_sec=0.0, end_sec=1.0)]
    overlays = build_voiceover_overlays(
        cues,
        session=session,
        block_timeline_start_sec=3.0,
    )
    assert len(overlays) == 1
    assert overlays[0].start_sec == pytest.approx(3.0)
    assert TIMELINE_BLOCK_ID_PARAM not in overlays[0].params


def test_voiceover_orchestrator_execute_audio_only_mocked(tmp_path, monkeypatch):
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_plan_service import VoiceoverPlanService
    from backend.schemas.edit_session import EditSessionUpdateRequest
    from backend.utils.edge_tts_service import SynthesizedSpeech

    project_id = "proj_vo_b"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()
    library_video = tmp_path / "placeholder.mp4"
    library_video.write_bytes(b"not-a-real-video")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_orchestrator.resolve_library_video_path",
        lambda _asset_id: library_video,
    )

    async def fake_synthesize(*_args, **_kwargs):
        return SynthesizedSpeech(
            voice="zh-CN-XiaoxiaoNeural",
            duration_sec=2.5,
            cues=[
                SubtitleCueTiming(text="测试口播。", start_sec=0.0, end_sec=2.5),
            ],
            word_timings=[
                SubtitleCueTiming(text="测", start_sec=0.0, end_sec=0.5, boundary_type="WordEstimate"),
                SubtitleCueTiming(text="试", start_sec=0.5, end_sec=1.0, boundary_type="WordEstimate"),
            ],
        )

    monkeypatch.setattr(
        "backend.services.voiceover_orchestrator.synthesize_with_timings",
        fake_synthesize,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO B Test")
    vo_service = VoiceoverPlanService(session_service=session_service)

    plan = VoiceoverPlan(
        id="vo-plan-b",
        status=VoiceoverPlanStatus.CONFIRMED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="测试口播。",
                visual_brief="画面",
                search_queries=["test"],
                status=VoiceoverSegmentStatus.SCRIPT_CONFIRMED,
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
    )

    session_service._import_bgm_from_local_file = lambda *args, **kwargs: kwargs[2]  # noqa: SLF001
    original_import = session_service.import_media_from_path

    def fake_import_media(project_id, session_id, source_path, **kwargs):
        from backend.schemas.edit_session import EditBlock, EditBlockMedia, EditBlockTrim, EditBlockOverlay

        session = session_service.get_session(project_id, session_id)
        block = EditBlock(
            id="block-vo-1",
            source_clip_id="import-test",
            title="占位",
            media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
            trim=EditBlockTrim(in_sec=0.0, out_sec=30.0),
            overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
            duration_sec=30.0,
        )
        updated = session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=[*session.sequence, block]),
        )
        return updated, block, "reference"

    monkeypatch.setattr(session_service, "import_media_from_path", fake_import_media)
    monkeypatch.setattr(session_service, "probe_imported_block_duration", lambda *_args, **_kwargs: 30.0)

    def fake_import_tts(project_id, session_id, session, source_path, display_name, **kwargs):
        from backend.schemas.edit_session import AudioAssetMeta, EditSessionUpdateRequest

        asset_id = "audio-asset-1"
        return session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                audio_assets=[
                    *(session.audio_assets or []),
                    AudioAssetMeta(
                        id=asset_id,
                        name=display_name,
                        path="tts.mp3",
                        duration_sec=2.5,
                        category="sfx",
                    ),
                ]
            ),
        )

    orchestrator = vo_service.orchestrator
    monkeypatch.setattr(orchestrator, "_import_tts_asset", fake_import_tts)

    session, updated_plan, note = asyncio.run(
        vo_service.execute_plan(
            project_id,
            created.id,
            VoiceoverExecuteRequest(),
        )
    )

    assert "已执行" in note
    assert updated_plan.status == VoiceoverPlanStatus.COMPLETED
    seg = updated_plan.segments[0]
    assert seg.status == VoiceoverSegmentStatus.TTS_DONE
    assert seg.tts.duration_sec == pytest.approx(2.5)
    assert len(session.overlay_elements or []) >= 1
    assert len(session.audio_elements or []) == 1
    assert len(session.sequence) == 0
    assert not seg.broll.block_id


def test_voiceover_orchestrator_execute_segment_mocked(tmp_path, monkeypatch):
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_plan_service import VoiceoverPlanService
    from backend.schemas.edit_session import EditSessionUpdateRequest
    from backend.utils.edge_tts_service import SynthesizedSpeech

    project_id = "proj_vo_b_placeholder"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()
    library_video = tmp_path / "placeholder.mp4"
    library_video.write_bytes(b"not-a-real-video")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_orchestrator.resolve_library_video_path",
        lambda _asset_id: library_video,
    )

    async def fake_synthesize(*_args, **_kwargs):
        return SynthesizedSpeech(
            voice="zh-CN-XiaoxiaoNeural",
            duration_sec=2.5,
            cues=[
                SubtitleCueTiming(text="测试口播。", start_sec=0.0, end_sec=2.5),
            ],
            word_timings=[
                SubtitleCueTiming(text="测", start_sec=0.0, end_sec=0.5, boundary_type="WordEstimate"),
                SubtitleCueTiming(text="试", start_sec=0.5, end_sec=1.0, boundary_type="WordEstimate"),
            ],
        )

    monkeypatch.setattr(
        "backend.services.voiceover_orchestrator.synthesize_with_timings",
        fake_synthesize,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO B Placeholder Test")
    vo_service = VoiceoverPlanService(session_service=session_service)

    plan = VoiceoverPlan(
        id="vo-plan-b",
        status=VoiceoverPlanStatus.CONFIRMED,
        user_brief="测试",
        placeholder_library_asset_id="lib-test",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="测试口播。",
                visual_brief="画面",
                search_queries=["test"],
                status=VoiceoverSegmentStatus.SCRIPT_CONFIRMED,
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
    )

    session_service._import_bgm_from_local_file = lambda *args, **kwargs: kwargs[2]  # noqa: SLF001

    def fake_import_media(project_id, session_id, source_path, **kwargs):
        from backend.schemas.edit_session import EditBlock, EditBlockMedia, EditBlockTrim, EditBlockOverlay

        session = session_service.get_session(project_id, session_id)
        block = EditBlock(
            id="block-vo-1",
            source_clip_id="import-test",
            title="占位",
            media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
            trim=EditBlockTrim(in_sec=0.0, out_sec=30.0),
            overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
            duration_sec=30.0,
        )
        updated = session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=[*session.sequence, block]),
        )
        return updated, block, "reference"

    monkeypatch.setattr(session_service, "import_media_from_path", fake_import_media)
    monkeypatch.setattr(session_service, "probe_imported_block_duration", lambda *_args, **_kwargs: 30.0)

    def fake_import_tts(project_id, session_id, session, source_path, display_name, **kwargs):
        from backend.schemas.edit_session import AudioAssetMeta, EditSessionUpdateRequest

        asset_id = "audio-asset-1"
        return session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                audio_assets=[
                    *(session.audio_assets or []),
                    AudioAssetMeta(
                        id=asset_id,
                        name=display_name,
                        path="tts.mp3",
                        duration_sec=2.5,
                        category="sfx",
                    ),
                ]
            ),
        )

    orchestrator = vo_service.orchestrator
    monkeypatch.setattr(orchestrator, "_import_tts_asset", fake_import_tts)

    session, updated_plan, note = asyncio.run(
        vo_service.execute_plan(
            project_id,
            created.id,
            VoiceoverExecuteRequest(placeholder_library_asset_id="lib-test"),
        )
    )

    assert "已执行" in note
    assert updated_plan.status == VoiceoverPlanStatus.COMPLETED
    seg = updated_plan.segments[0]
    assert seg.status == VoiceoverSegmentStatus.TTS_DONE
    assert seg.tts.duration_sec == pytest.approx(2.5)
    assert len(session.overlay_elements or []) >= 1
    assert len(session.audio_elements or []) == 1
    assert len(session.sequence) == 1
    assert seg.broll.block_id


def test_voiceover_rerun_tts_preserves_video_block(tmp_path, monkeypatch):
    from backend.schemas.edit_session import (
        AudioAssetMeta,
        AudioClipElement,
        EditBlock,
        EditBlockMedia,
        EditBlockOverlay,
        EditBlockTrim,
        EditSessionUpdateRequest,
        EditOverlayElement,
    )
    from backend.schemas.voiceover_plan import (
        VoiceoverBrollState,
        VoiceoverSubtitleState,
        VoiceoverTtsState,
    )
    from backend.services.edit_session_service import EditSessionService
    from backend.services.voiceover_plan_service import VoiceoverPlanService
    from backend.utils.edge_tts_service import SynthesizedSpeech

    project_id = "proj_vo_rerun"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()
    library_video = tmp_path / "placeholder.mp4"
    library_video.write_bytes(b"not-a-real-video")

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.voiceover_orchestrator.resolve_library_video_path",
        lambda _asset_id: library_video,
    )

    async def fake_synthesize(*_args, **_kwargs):
        return SynthesizedSpeech(
            voice="zh-CN-XiaoxiaoNeural",
            duration_sec=3.0,
            cues=[
                SubtitleCueTiming(text="测试口播。", start_sec=0.0, end_sec=3.0),
            ],
            word_timings=[],
        )

    monkeypatch.setattr(
        "backend.services.voiceover_orchestrator.synthesize_with_timings",
        fake_synthesize,
    )

    session_service = EditSessionService(db=None)
    created = session_service.create_blank_session(project_id, name="VO Rerun Test")
    vo_service = VoiceoverPlanService(session_service=session_service)

    block = EditBlock(
        id="block-vo-keep",
        source_clip_id="import-test",
        title="占位",
        media=EditBlockMedia(type="imported_clip", path="placeholder.mp4"),
        trim=EditBlockTrim(in_sec=0.0, out_sec=2.5),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=2.5,
    )
    old_clip = AudioClipElement(
        id="vo-audio-old",
        asset_id="audio-old",
        track_id="default-audio",
        start_sec=0.0,
        duration_sec=2.5,
        trim_start_sec=0.0,
        trim_end_sec=2.5,
        volume=1.0,
        block_id=block.id,
        block_offset_sec=0.0,
    )
    old_overlay = EditOverlayElement(
        id="vo-sub-old",
        type="text",
        start_sec=0.0,
        duration_sec=2.5,
        params={"text": "旧字幕"},
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(
            sequence=[block],
            audio_elements=[old_clip],
            overlay_elements=[old_overlay],
        ),
    )

    plan = VoiceoverPlan(
        id="vo-plan-rerun",
        status=VoiceoverPlanStatus.COMPLETED,
        user_brief="测试",
        segments=[
            VoiceoverSegment(
                id="seg-1",
                index=1,
                narration_text="测试口播。",
                visual_brief="画面",
                search_queries=["test"],
                status=VoiceoverSegmentStatus.TTS_DONE,
                tts=VoiceoverTtsState(
                    asset_id="audio-old",
                    audio_clip_id=old_clip.id,
                    duration_sec=2.5,
                    timeline_start_sec=0.0,
                ),
                subtitles=VoiceoverSubtitleState(
                    overlay_ids=[old_overlay.id],
                    alignment="sentence",
                ),
                broll=VoiceoverBrollState(
                    block_id=block.id,
                    library_asset_id="lib-test",
                    source_in_sec=0.0,
                    source_out_sec=2.5,
                ),
            )
        ],
    )
    session_service.update_session(
        project_id,
        created.id,
        EditSessionUpdateRequest(voiceover_plan=plan),
    )

    tts_assets: list[str] = []

    def fake_import_tts(project_id, session_id, session, source_path, display_name, **kwargs):
        asset_id = f"audio-asset-{len(tts_assets) + 1}"
        tts_assets.append(asset_id)
        return session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                audio_assets=[
                    *(session.audio_assets or []),
                    AudioAssetMeta(
                        id=asset_id,
                        name=display_name,
                        path="tts.mp3",
                        duration_sec=3.0,
                        category="sfx",
                    ),
                ]
            ),
        )

    orchestrator = vo_service.orchestrator
    monkeypatch.setattr(orchestrator, "_import_tts_asset", fake_import_tts)
    monkeypatch.setattr(
        session_service,
        "probe_imported_block_duration",
        lambda *_args, **_kwargs: 30.0,
    )

    session, updated_plan, note = asyncio.run(
        vo_service.execute_segment(project_id, created.id, "seg-1")
    )

    assert "已完成" in note
    seg = updated_plan.segments[0]
    assert seg.status == VoiceoverSegmentStatus.TTS_DONE
    assert seg.tts.duration_sec == pytest.approx(3.0)
    assert seg.broll.block_id == block.id
    assert seg.tts.audio_clip_id != old_clip.id
    assert old_overlay.id not in (seg.subtitles.overlay_ids or [])
    assert len(session.sequence) == 1
    assert session.sequence[0].id == block.id
    assert session.sequence[0].trim.out_sec == pytest.approx(3.0)
    assert len(session.audio_elements or []) == 1
    assert session.audio_elements[0].id == seg.tts.audio_clip_id
    assert old_overlay.id not in {item.id for item in (session.overlay_elements or [])}

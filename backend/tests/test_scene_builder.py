from backend.pipeline.scene_builder import (
    build_composition_timeline,
    compile_export_plan,
    resolve_scene_at,
)
from backend.schemas.edit_session import EditBlock, EditBlockTrim, EditSession, EditSessionAudioSettings, EditExportSettings


def _block(block_id: str, duration: float, transition: str = "cut") -> EditBlock:
    return EditBlock(
        id=block_id,
        source_clip_id=block_id,
        title=block_id,
        media={"type": "step6_clip", "path": f"{block_id}.mp4"},
        trim=EditBlockTrim(in_sec=0.0, out_sec=duration),
        transition_out=transition,
        duration_sec=duration,
    )


def _session(blocks: list[EditBlock]) -> EditSession:
    return EditSession(
        id="s1",
        project_id="p1",
        name="test",
        sequence=blocks,
        export_settings=EditExportSettings(),
        audio_settings=EditSessionAudioSettings(),
        created_at="",
        updated_at="",
    )


def test_composition_timeline_dissolve_overlap():
    timeline = build_composition_timeline([_block("a", 4, "dissolve"), _block("b", 3)], 0.35)
    assert abs(timeline.total_duration_sec - 6.65) < 0.01
    assert abs(timeline.segments[1].composition_start_sec - 3.65) < 0.01


def test_resolve_scene_crossfade():
    session = _session([_block("a", 4, "dissolve"), _block("b", 3)])
    scene = resolve_scene_at(session, 3.8, burn_subtitles=True)
    assert len(scene.video_layers) == 2
    assert scene.in_dissolve is True
    assert scene.dissolve_progress is not None
    assert scene.dissolve_progress > 0


def test_compile_export_plan_canvas():
    plan = compile_export_plan(_session([_block("a", 4)]), burn_subtitles=True)
    assert plan.canvas.width == 608
    assert plan.canvas.height == 1080
    assert plan.timeline.total_duration_sec == 4

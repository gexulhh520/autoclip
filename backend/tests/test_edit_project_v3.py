from backend.schemas.edit_project_v3 import migrate_session_to_v3, normalize_session
from backend.schemas.edit_session import EditBlock, EditBlockTrim, EditSession, EditSessionAudioSettings, EditExportSettings


def _block(block_id: str, duration: float) -> EditBlock:
    return EditBlock(
        id=block_id,
        source_clip_id=block_id,
        title=block_id,
        media={"type": "step6_clip", "path": f"{block_id}.mp4"},
        trim=EditBlockTrim(in_sec=0.0, out_sec=duration),
        duration_sec=duration,
    )


def test_normalize_session_upgrades_v2_to_v3():
    raw = EditSession(
        id="s1",
        project_id="p1",
        name="test",
        schema_version=2,
        sequence=[_block("a", 4)],
        export_settings=EditExportSettings(),
        audio_settings=EditSessionAudioSettings(),
        created_at="",
        updated_at="",
    ).model_dump()
    raw["schema_version"] = 2
    session = normalize_session(raw)
    assert session.schema_version == 3


def test_migrate_session_to_v3_builds_tracks():
    session = EditSession(
        id="s1",
        project_id="p1",
        name="test",
        sequence=[_block("a", 4), _block("b", 3)],
        export_settings=EditExportSettings(),
        audio_settings=EditSessionAudioSettings(),
        created_at="",
        updated_at="",
    )
    project = migrate_session_to_v3(session)
    assert project.schema_version == 3
    assert len(project.media_pool) == 2
    assert len(project.scenes[0].tracks.main) == 2
    assert project.scenes[0].tracks.main[1].start_time == 4.0

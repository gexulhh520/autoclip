from backend.pipeline.edit_renderer import is_block_video_audio_muted
from backend.schemas.edit_session import EditBlock, EditSession, EditSessionAudioSettings, EditExportSettings, VideoTrackMeta


def _block(block_id: str, track_id: str | None = None) -> EditBlock:
    return EditBlock(
        id=block_id,
        source_clip_id=block_id,
        title=block_id,
        media={"type": "step6_clip", "path": f"{block_id}.mp4"},
        trim={"in_sec": 0, "out_sec": 5},
        duration_sec=5,
        track_id=track_id,
    )


def _session(*blocks: EditBlock, tracks: list[VideoTrackMeta] | None = None) -> EditSession:
    return EditSession(
        id="s1",
        project_id="p1",
        name="test",
        sequence=list(blocks),
        video_tracks=tracks or [],
        export_settings=EditExportSettings(),
        audio_settings=EditSessionAudioSettings(),
        created_at="",
        updated_at="",
    )


def test_is_block_video_audio_muted_respects_track_muted():
    session = _session(
        _block("a", "default-video"),
        tracks=[VideoTrackMeta(id="default-video", name="Video", order=0, muted=True)],
    )
    assert is_block_video_audio_muted(session, session.sequence[0]) is True


def test_is_block_video_audio_muted_allows_unmuted_track():
    session = _session(
        _block("a", "overlay-track"),
        tracks=[
            VideoTrackMeta(id="default-video", name="Video", order=0, muted=True),
            VideoTrackMeta(id="overlay-track", name="Video 2", order=1, muted=False),
        ],
    )
    assert is_block_video_audio_muted(session, session.sequence[0]) is False

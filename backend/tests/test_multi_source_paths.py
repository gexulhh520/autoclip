"""Path helpers for multi-source projects."""

from backend.core.path_utils import (
    get_project_source_metadata_directory,
    get_project_source_raw_directory,
    resolve_project_metadata_directory,
    resolve_source_video_path,
)


def test_source_directories(tmp_path, monkeypatch):
    project_id = "p_multi_1"
    source_id = "src_abc"

    monkeypatch.setattr(
        "backend.core.path_utils.get_project_directory",
        lambda pid: tmp_path / pid,
    )

    raw = get_project_source_raw_directory(project_id, source_id)
    meta = get_project_source_metadata_directory(project_id, source_id)
    assert raw == tmp_path / project_id / "raw" / "sources" / source_id
    assert meta == tmp_path / project_id / "metadata" / "sources" / source_id

    default_meta = resolve_project_metadata_directory(project_id)
    assert default_meta == tmp_path / project_id / "metadata"

    scoped_meta = resolve_project_metadata_directory(project_id, source_id)
    assert scoped_meta == meta

    video = resolve_source_video_path(project_id, source_id)
    assert video.name == "input.mp4"
    assert source_id in str(video)

"""Tests for multi-source project helpers."""

from pathlib import Path

from backend.services.project_source_service import (
    aggregate_project_status,
    attach_multi_source_to_config,
    build_source_records,
    get_pending_sources,
    is_multi_source_project,
    mark_source_completed,
    mark_source_processing,
    summarize_multi_source,
)
from backend.schemas.project_source import ProjectSourceStatus


def test_build_and_attach_multi_source():
    records = build_source_records(["a.mp4", "b.mp4"])
    assert len(records) == 2
    assert records[0].index == 0
    assert records[1].index == 1

    config = attach_multi_source_to_config({"clip_goal": "golden_quote"}, records)
    assert is_multi_source_project(config)
    assert len(config["multi_source"]["sources"]) == 2


def test_pending_sources_and_status_flow():
    records = build_source_records(["a.mp4", "b.mp4"])
    config = attach_multi_source_to_config({}, records)

    pending = get_pending_sources(config)
    assert len(pending) == 2

    config = mark_source_processing(config, records[0].id)
    from backend.services.project_source_service import get_sources_ordered

    assert aggregate_project_status(get_sources_ordered(config)) == "processing"

    config = mark_source_completed(config, records[0].id, clips_count=3)
    summary = summarize_multi_source(config)
    assert summary.total_sources == 2
    assert summary.completed_sources == 1
    assert summary.sources[0].status == ProjectSourceStatus.COMPLETED


def test_resolve_source_paths(tmp_path, monkeypatch):
    project_id = "proj_test_multi"
    monkeypatch.setattr(
        "backend.services.project_source_service.get_project_source_raw_directory",
        lambda pid, sid: tmp_path / pid / "raw" / "sources" / sid,
    )
    from backend.services.project_source_service import assign_source_paths

    record = build_source_records(["clip.mp4"])[0]
    updated = assign_source_paths(project_id, record)
    assert updated.video_path.endswith("input.mp4")
    assert project_id in updated.video_path

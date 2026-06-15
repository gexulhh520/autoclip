import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend.services.pipeline_steps_service import (
    _resolve_effective_source_id,
    get_pipeline_step_result,
    get_pipeline_steps,
)


def _multi_source_project(tmp_path, monkeypatch, source_specs):
    project_id = "proj-multi"
    project_dir = tmp_path / "projects" / project_id
    sources = []
    for index, spec in enumerate(source_specs):
        source_id = spec["id"]
        raw_dir = project_dir / "raw" / "sources" / source_id
        meta_dir = project_dir / "metadata" / "sources" / source_id
        raw_dir.mkdir(parents=True)
        meta_dir.mkdir(parents=True)
        (raw_dir / "input.mp4").write_bytes(b"video")
        (raw_dir / "input.srt").write_text("srt", encoding="utf-8")
        if spec.get("outline"):
            (meta_dir / "step1_outline.json").write_text(
                json.dumps([{"title": spec["outline"], "subtopics": [], "chunk_index": 0}]),
                encoding="utf-8",
            )
        sources.append(
            {
                "id": source_id,
                "index": index,
                "original_filename": spec.get("name", f"video_{index + 1}"),
                "source_url": spec.get("url"),
                "platform": spec.get("platform"),
                "status": spec.get("status", "pending"),
                "video_path": str(raw_dir / "input.mp4"),
                "subtitle_path": str(raw_dir / "input.srt"),
            }
        )

    processing_config = {
        "multi_source": {
            "enabled": True,
            "current_source_index": 1,
            "sources": sources,
        }
    }
    project = SimpleNamespace(
        id=project_id,
        status=SimpleNamespace(value="processing"),
        processing_config=processing_config,
        project_metadata={},
    )
    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_progress_snapshot",
        lambda _pid: None,
    )
    monkeypatch.setattr(
        "backend.services.pipeline_steps_service._is_pipeline_running",
        lambda *_args, **_kwargs: False,
    )
    return project_id, project, sources


def test_resolve_effective_source_id_prefers_explicit():
    processing_config = {
        "multi_source": {
            "enabled": True,
            "current_source_index": 0,
            "sources": [
                {"id": "src_a", "index": 0, "original_filename": "a", "status": "completed"},
                {"id": "src_b", "index": 1, "original_filename": "b", "status": "processing"},
            ],
        }
    }
    effective, record = _resolve_effective_source_id(processing_config, "src_a")
    assert effective == "src_a"
    assert record.original_filename == "a"


def test_get_pipeline_step_result_uses_per_source_metadata(tmp_path, monkeypatch):
    project_id, project, sources = _multi_source_project(
        tmp_path,
        monkeypatch,
        [
            {"id": "src_a", "name": "first", "outline": "话题A", "status": "completed"},
            {"id": "src_b", "name": "second", "outline": "话题B", "status": "pending"},
        ],
    )

    result_a = get_pipeline_step_result(project_id, "step1_outline", project, source_id="src_a")
    result_b = get_pipeline_step_result(project_id, "step1_outline", project, source_id="src_b")

    assert result_a["items"][0]["title"] == "话题A"
    assert result_b["items"][0]["title"] == "话题B"


def test_completed_source_does_not_show_running_for_other_active_source(tmp_path, monkeypatch):
    project_id, project, sources = _multi_source_project(
        tmp_path,
        monkeypatch,
        [
            {"id": "src_a", "name": "first", "outline": "话题A", "status": "completed"},
            {"id": "src_b", "name": "second", "status": "processing"},
        ],
    )
    monkeypatch.setattr(
        "backend.services.pipeline_steps_service._is_pipeline_running",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "backend.services.pipeline_steps_service._infer_running_step",
        lambda *_args, **_kwargs: "step2_timeline",
    )

    completed_view = get_pipeline_steps(project_id, project, source_id="src_a")
    step2_completed = next(s for s in completed_view["steps"] if s["id"] == "step2_timeline")
    assert step2_completed["status"] != "running"

    active_view = get_pipeline_steps(project_id, project, source_id="src_b")
    step2_active = next(s for s in active_view["steps"] if s["id"] == "step2_timeline")
    assert step2_active["status"] == "running"

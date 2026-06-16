import json
from pathlib import Path

import pytest

from backend.services.pipeline_steps_service import (
    STEP_BY_ID,
    _build_step6_export_items,
    _count_exported_clips,
    _step_completed,
)


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def test_count_exported_clips_prefers_clip_paths(tmp_path):
    project_dir = tmp_path / "projects" / "demo"
    _write_json(
        project_dir / "output" / "step6_video_output.json",
        {
            "clips_generated": 7,
            "clip_paths": ["a.mp4", "b.mp4", "c.mp4"],
            "collections_generated": 0,
        },
    )
    _write_json(
        project_dir / "metadata" / "clips_metadata.json",
        [{"id": str(i)} for i in range(1, 8)],
    )

    assert _count_exported_clips(project_dir) == 3


def test_build_step6_export_items_includes_titles(tmp_path):
    project_dir = tmp_path / "projects" / "demo"
    _write_json(
        project_dir / "metadata" / "clips_metadata.json",
        [
            {"id": "1", "generated_title": "第一句"},
            {"id": "2", "generated_title": "第二句"},
        ],
    )
    clips_dir = project_dir / "output" / "clips"
    clips_dir.mkdir(parents=True)
    (clips_dir / "1_第一句.mp4").write_bytes(b"x")
    (clips_dir / "2_第二句.mp4").write_bytes(b"x")

    items, summary = _build_step6_export_items(project_dir)
    clip_items = [item for item in items if item.get("type") == "clip"]

    assert summary["clips_generated"] == 2
    assert len(clip_items) == 2
    assert clip_items[0]["title"] == "第一句"
    assert clip_items[0]["path"]


def test_step_completed_uses_exported_clip_count(tmp_path, monkeypatch):
    project_id = "demo-step6-count"
    project_dir = tmp_path / "projects" / project_id
    _write_json(
        project_dir / "metadata" / "clips_metadata.json",
        [{"id": str(i), "generated_title": f"clip-{i}"} for i in range(1, 8)],
    )
    _write_json(
        project_dir / "output" / "step6_video_output.json",
        {
            "clips_generated": 7,
            "clip_paths": [],
            "collections_generated": 0,
        },
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )

    ok, count, _detail = _step_completed(STEP_BY_ID["step6_video"], project_dir)
    assert ok is True
    assert count == 7

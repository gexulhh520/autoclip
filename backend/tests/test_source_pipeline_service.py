import json
from pathlib import Path

import pytest

from backend.services.source_pipeline_service import (
    clear_source_step_outputs,
    is_source_video_ready,
    resolve_metadata_dir_for_read,
)


def test_clear_source_step_outputs_isolated(tmp_path, monkeypatch):
    project_id = "proj-clear"
    project_dir = tmp_path / "projects" / project_id
    src_a = project_dir / "metadata" / "sources" / "src_a"
    src_b = project_dir / "metadata" / "sources" / "src_b"
    src_a.mkdir(parents=True)
    src_b.mkdir(parents=True)
    (src_a / "step1_outline.json").write_text("[]", encoding="utf-8")
    (src_b / "step1_outline.json").write_text('[{"title":"b"}]', encoding="utf-8")
    monkeypatch.setattr(
        "backend.services.source_pipeline_service.get_project_source_metadata_directory",
        lambda _pid, sid: project_dir / "metadata" / "sources" / sid,
    )
    monkeypatch.setattr(
        "backend.services.source_pipeline_service.get_project_directory",
        lambda _pid: project_dir,
    )
    clear_source_step_outputs(project_id, "src_a", "step1_outline")
    assert not (src_a / "step1_outline.json").exists()
    assert (src_b / "step1_outline.json").exists()


def test_resolve_metadata_dir_legacy_fallback(tmp_path):
    project_dir = tmp_path / "projects" / "p1"
    root = project_dir / "metadata"
    root.mkdir(parents=True)
    (root / "step1_outline.json").write_text("[]", encoding="utf-8")
    per = project_dir / "metadata" / "sources" / "src_0"
    per.mkdir(parents=True)
    cfg = {
        "multi_source": {
            "enabled": True,
            "sources": [
                {
                    "id": "src_0",
                    "index": 0,
                    "original_filename": "a",
                    "status": "pending",
                }
            ],
        }
    }
    resolved = resolve_metadata_dir_for_read(project_dir, cfg, "src_0", source_index=0)
    assert resolved == root


def test_is_source_video_ready(tmp_path, monkeypatch):
    project_id = "proj-vid"
    video = tmp_path / "projects" / project_id / "raw" / "sources" / "src_x" / "input.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"data")
    monkeypatch.setattr(
        "backend.services.source_pipeline_service.resolve_source_video_path",
        lambda _pid, _sid: video,
    )
    assert is_source_video_ready(project_id, "src_x")

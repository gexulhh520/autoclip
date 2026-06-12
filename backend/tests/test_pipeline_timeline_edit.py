import json
from pathlib import Path

import pytest

from backend.services.pipeline_steps_service import update_pipeline_timeline_item


def test_update_pipeline_timeline_item(tmp_path, monkeypatch):
    project_id = "test-timeline-edit"
    metadata_dir = tmp_path / "projects" / project_id / "metadata"
    metadata_dir.mkdir(parents=True)
    timeline_path = metadata_dir / "step2_timeline.json"
    timeline_path.write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "原始金句",
                    "content": ["核心原话", "补充"],
                    "start_time": "00:01:00,000",
                    "end_time": "00:01:30,000",
                    "chunk_index": 0,
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: tmp_path / "projects" / project_id,
    )

    result = update_pipeline_timeline_item(
        project_id,
        "1",
        {
            "outline": "修正金句",
            "content": ["新原话"],
            "start_time": "00:01:05,500",
            "end_time": "00:01:25,000",
        },
    )

    assert result["success"] is True
    assert result["item"]["start_time"] == "00:01:05,500"

    saved = json.loads(timeline_path.read_text(encoding="utf-8"))
    assert saved[0]["outline"] == "修正金句"
    assert saved[0]["content"] == ["新原话"]


def test_update_pipeline_timeline_item_rejects_invalid_range(tmp_path, monkeypatch):
    project_id = "test-timeline-invalid"
    metadata_dir = tmp_path / "projects" / project_id / "metadata"
    metadata_dir.mkdir(parents=True)
    (metadata_dir / "step2_timeline.json").write_text(
        json.dumps(
            [
                {
                    "id": "2",
                    "outline": "x",
                    "start_time": "00:01:00,000",
                    "end_time": "00:01:30,000",
                }
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: tmp_path / "projects" / project_id,
    )

    with pytest.raises(ValueError, match="结束时间必须晚于开始时间"):
        update_pipeline_timeline_item(
            project_id,
            "2",
            {
                "start_time": "00:02:00,000",
                "end_time": "00:01:00,000",
            },
        )

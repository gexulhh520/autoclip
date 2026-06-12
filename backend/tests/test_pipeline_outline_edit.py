import json
from pathlib import Path

import pytest

from backend.services.pipeline_steps_service import update_pipeline_outline_item


def test_update_pipeline_outline_item(tmp_path, monkeypatch):
    project_id = "test-outline-edit"
    project_dir = tmp_path / "projects" / project_id / "metadata"
    project_dir.mkdir(parents=True)
    outline_path = project_dir / "step1_outline.json"
    outline_path.write_text(
        json.dumps(
            [
                {
                    "title": "原始标题",
                    "subtopics": ["第一句", "第二句"],
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

    result = update_pipeline_outline_item(
        project_id,
        1,
        {
            "title": "修正后的金句",
            "subtopics": ["核心原话", "补充要点"],
            "chunk_index": 0,
        },
    )

    assert result["success"] is True
    assert result["item"]["title"] == "修正后的金句"

    saved = json.loads(outline_path.read_text(encoding="utf-8"))
    assert saved[0]["title"] == "修正后的金句"
    assert saved[0]["subtopics"] == ["核心原话", "补充要点"]


def test_update_pipeline_outline_item_rejects_empty_title(tmp_path, monkeypatch):
    project_id = "test-outline-edit-empty"
    project_dir = tmp_path / "projects" / project_id / "metadata"
    project_dir.mkdir(parents=True)
    (project_dir / "step1_outline.json").write_text("[]", encoding="utf-8")

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: tmp_path / "projects" / project_id,
    )

    with pytest.raises(ValueError, match="标题不能为空"):
        update_pipeline_outline_item(project_id, 1, {"title": "  ", "subtopics": []})

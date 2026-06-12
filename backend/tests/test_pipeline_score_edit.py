import json
from pathlib import Path

import pytest

from backend.services.pipeline_steps_service import update_pipeline_score_item


def _write_scored(metadata_dir: Path, clips: list) -> None:
    metadata_dir.mkdir(parents=True, exist_ok=True)
    (metadata_dir / "step3_all_scored.json").write_text(
        json.dumps(clips, ensure_ascii=False),
        encoding="utf-8",
    )
    (metadata_dir / "step3_high_score_clips.json").write_text("[]", encoding="utf-8")


def test_update_pipeline_score_item_manual_pass(tmp_path, monkeypatch):
    project_id = "test-score-edit"
    metadata_dir = tmp_path / "projects" / project_id / "metadata"
    _write_scored(
        metadata_dir,
        [
            {
                "id": "1",
                "outline": "人生如白驹过隙",
                "final_score": 0.3,
                "recommend_reason": "陈词滥调",
                "start_time": "00:00:35,271",
                "end_time": "00:00:40,150",
                "content": ["人生如白驹过隙，转眼即逝"],
            },
            {
                "id": "2",
                "outline": "宁爱本江一年头",
                "final_score": 0.85,
                "recommend_reason": "画面感强",
                "start_time": "00:00:35,150",
                "end_time": "00:01:00,620",
                "content": ["宁爱本江一年头"],
            },
        ],
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: tmp_path / "projects" / project_id,
    )

    result = update_pipeline_score_item(
        project_id,
        "1",
        {
            "final_score": 0.3,
            "recommend_reason": "保留为素材，手动通过",
            "passed": True,
        },
    )

    assert result["success"] is True
    assert result["item"]["passed"] is True
    assert result["high_score_count"] == 2

    all_scored = json.loads((metadata_dir / "step3_all_scored.json").read_text(encoding="utf-8"))
    assert all_scored[0]["manual_passed"] is True
    assert all_scored[0]["recommend_reason"] == "保留为素材，手动通过"

    high_score = json.loads((metadata_dir / "step3_high_score_clips.json").read_text(encoding="utf-8"))
    assert len(high_score) == 2
    assert high_score[0]["id"] == "1"


def test_update_pipeline_score_item_manual_fail(tmp_path, monkeypatch):
    project_id = "test-score-fail"
    metadata_dir = tmp_path / "projects" / project_id / "metadata"
    _write_scored(
        metadata_dir,
        [
            {
                "id": "2",
                "outline": "高分条目",
                "final_score": 0.9,
                "recommend_reason": "很好",
                "start_time": "00:00:00,000",
                "end_time": "00:00:10,000",
            },
        ],
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: tmp_path / "projects" / project_id,
    )

    result = update_pipeline_score_item(
        project_id,
        "2",
        {
            "final_score": 0.9,
            "recommend_reason": "改判未通过",
            "passed": False,
        },
    )

    assert result["item"]["passed"] is False
    assert result["high_score_count"] == 0

    high_score = json.loads((metadata_dir / "step3_high_score_clips.json").read_text(encoding="utf-8"))
    assert high_score == []


def test_update_pipeline_score_item_rejects_invalid_score(tmp_path, monkeypatch):
    project_id = "test-score-invalid"
    metadata_dir = tmp_path / "projects" / project_id / "metadata"
    _write_scored(
        metadata_dir,
        [
            {
                "id": "1",
                "outline": "x",
                "final_score": 0.5,
                "recommend_reason": "ok",
            },
        ],
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: tmp_path / "projects" / project_id,
    )

    with pytest.raises(ValueError, match="0–1"):
        update_pipeline_score_item(
            project_id,
            "1",
            {
                "final_score": 1.5,
                "recommend_reason": "too high",
            },
        )

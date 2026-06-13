import json
from pathlib import Path

import pytest

from backend.services.pipeline_steps_service import (
    get_timeline_srt_segments,
    regenerate_timeline_item_content,
    update_srt_entry,
)


def _write_srt(path: Path) -> None:
    path.write_text(
        """1
00:00:58,000 --> 00:01:02,000
人生如梦

2
00:01:02,500 --> 00:01:08,000
一樽还酹江月

3
00:01:20,000 --> 00:01:25,000
天生我才必有用
""",
        encoding="utf-8",
    )


def test_get_timeline_srt_segments(tmp_path, monkeypatch):
    project_id = "test-calibration-segments"
    project_dir = tmp_path / "projects" / project_id
    raw_dir = project_dir / "raw"
    raw_dir.mkdir(parents=True)
    _write_srt(raw_dir / "input.srt")

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )

    result = get_timeline_srt_segments(
        project_id,
        "00:01:00,000",
        "00:01:10,000",
        padding_seconds=2.0,
    )

    assert result["segment_count"] == 2
    assert any(seg["text"] == "人生如梦" for seg in result["segments"])
    assert any(seg["in_range"] for seg in result["segments"])


def test_update_srt_entry(tmp_path, monkeypatch):
    project_id = "test-calibration-srt-edit"
    project_dir = tmp_path / "projects" / project_id
    raw_dir = project_dir / "raw"
    raw_dir.mkdir(parents=True)
    srt_path = raw_dir / "input.srt"
    _write_srt(srt_path)

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )

    result = update_srt_entry(project_id, 1, "人生若梦")
    assert result["success"] is True
    assert result["text"] == "人生若梦"
    assert "人生若梦" in srt_path.read_text(encoding="utf-8")


def test_regenerate_timeline_item_content(tmp_path, monkeypatch):
    project_id = "test-calibration-regenerate"
    project_dir = tmp_path / "projects" / project_id
    raw_dir = project_dir / "raw"
    raw_dir.mkdir(parents=True)
    _write_srt(raw_dir / "input.srt")

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )

    class FakeLLM:
        def call_with_retry(self, _prompt, _input_data, max_retries=3):
            return json.dumps(
                {
                    "outline": "人生如梦，一樽还酹江月",
                    "content": ["人生如梦", "一樽还酹江月"],
                },
                ensure_ascii=False,
            )

        def parse_json_response(self, response):
            return json.loads(response)

    monkeypatch.setattr(
        "backend.utils.llm_client.LLMClient",
        lambda: FakeLLM(),
    )

    result = regenerate_timeline_item_content(
        project_id,
        "00:01:00,000",
        "00:01:10,000",
        mode="both",
    )

    assert result["success"] is True
    assert "人生如梦" in result["outline"]
    assert len(result["content"]) >= 1


def test_regenerate_rejects_empty_range(tmp_path, monkeypatch):
    project_id = "test-calibration-empty"
    project_dir = tmp_path / "projects" / project_id
    raw_dir = project_dir / "raw"
    raw_dir.mkdir(parents=True)
    _write_srt(raw_dir / "input.srt")

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )

    with pytest.raises(ValueError, match="没有可用字幕"):
        regenerate_timeline_item_content(
            project_id,
            "00:02:00,000",
            "00:02:10,000",
        )

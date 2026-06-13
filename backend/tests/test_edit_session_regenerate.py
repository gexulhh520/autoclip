"""EditSession LLM 重写测试。"""

import json
from pathlib import Path

import pytest

from backend.services.edit_session_service import EditSessionService


def _write_project(project_dir: Path) -> None:
    metadata_dir = project_dir / "metadata"
    clips_dir = project_dir / "output" / "clips"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)
    (clips_dir / "1_clip.mp4").write_bytes(b"fake")
    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "旧摘要",
                    "content": ["旧要点"],
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (metadata_dir / "template_config.json").write_text(
        json.dumps({"template_id": "golden_quote_cinema", "template_version": "1.3.0"}),
        encoding="utf-8",
    )


def test_regenerate_block_content_updates_session(tmp_path, monkeypatch):
    project_id = "edit-regenerate"
    project_dir = tmp_path / "projects" / project_id
    _write_project(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.regenerate_timeline_item_content",
        lambda *_args, **_kwargs: {
            "success": True,
            "outline": "新摘要",
            "content": ["新要点A", "新要点B"],
            "mode": "both",
        },
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1"])
    block_id = session.sequence[0].id
    updated = service.regenerate_block_content(project_id, session.id, block_id, mode="both")
    block = updated.sequence[0]
    assert block.overlay.outline == "新摘要"
    assert block.overlay.content == ["新要点A", "新要点B"]


def test_regenerate_requires_source_timecodes(tmp_path, monkeypatch):
    project_id = "edit-regenerate-missing"
    project_dir = tmp_path / "projects" / project_id
    _write_project(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1"])
    block = session.sequence[0]
    block.media.source_start_sec = None
    block.media.source_end_sec = None
    from backend.schemas.edit_session import EditSessionUpdateRequest

    service.update_session(
        project_id,
        session.id,
        EditSessionUpdateRequest(sequence=[block]),
    )

    with pytest.raises(ValueError, match="时间码"):
        service.regenerate_block_content(project_id, session.id, block.id)

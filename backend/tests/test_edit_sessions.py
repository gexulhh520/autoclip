"""EditSession API 与服务测试。"""
import json
from pathlib import Path

import pytest

from backend.pipeline.edit_renderer import preview_block_overlay
from backend.services.edit_session_service import EditSessionService


def _write_project_clips(project_dir: Path) -> None:
    metadata_dir = project_dir / "metadata"
    clips_dir = project_dir / "output" / "clips"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    (clips_dir / "1_天生我才必有用.mp4").write_bytes(b"fake")
    (clips_dir / "2_千金散尽还复来.mp4").write_bytes(b"fake")

    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "天生我才必有用",
                    "content": ["天生我才必有用", "千金散尽还复来"],
                    "recommend_reason": "金句",
                    "generated_title": "标题一",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                },
                {
                    "id": "2",
                    "outline": "第二段",
                    "content": ["第二段内容"],
                    "recommend_reason": "理由",
                    "generated_title": "标题二",
                    "start_time": "00:00:10,000",
                    "end_time": "00:00:15,000",
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    (metadata_dir / "template_config.json").write_text(
        json.dumps(
            {
                "template_id": "golden_quote_cinema",
                "template_version": "1.3.0",
                "template_rules": {"subtitle_style": "quote_cinema"},
                "overlay": {
                    "composer": "quote_cinema",
                    "renderer": "ass_stack",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_create_edit_session_from_metadata(tmp_path, monkeypatch):
    project_id = "edit-session-test"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1", "2"])

    assert session.project_id == project_id
    assert len(session.sequence) == 2
    assert session.template_id == "golden_quote_cinema"
    assert session.overlay_snapshot.get("composer") == "quote_cinema"
    assert session.sequence[0].media.path.startswith("output/clips/")
    assert session.sequence[0].overlay.content[0] == "天生我才必有用"

    saved = json.loads((project_dir / "edit_sessions" / f"{session.id}.json").read_text(encoding="utf-8"))
    assert saved["schema_version"] == 1


def test_preview_block_overlay_from_session(tmp_path, monkeypatch):
    project_id = "edit-preview-overlay"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1"])
    preview = preview_block_overlay(session, session.sequence[0].id)
    assert preview["layout"] == "cinema"
    assert preview["applicable"] is True


def test_update_edit_session_sequence(tmp_path, monkeypatch):
    project_id = "edit-session-update"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1", "2"])
    sequence = list(reversed(session.sequence))
    from backend.schemas.edit_session import EditSessionUpdateRequest

    updated = service.update_session(
        project_id,
        session.id,
        EditSessionUpdateRequest(name="新名称", sequence=sequence),
    )
    assert updated.name == "新名称"
    assert updated.sequence[0].source_clip_id == session.sequence[1].source_clip_id

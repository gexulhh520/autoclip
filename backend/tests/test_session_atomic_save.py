"""EditSession 原子保存与并发写入测试。"""
from __future__ import annotations

import threading
from pathlib import Path

import pytest

from backend.schemas.edit_session import EditSession
from backend.services.edit_session_service import EditSessionService, _atomic_write_text


def test_atomic_write_text_concurrent_replace(tmp_path: Path):
    target = tmp_path / "session.json"
    target.write_text('{"v": 0}', encoding="utf-8")
    errors: list[Exception] = []

    def writer(value: int) -> None:
        try:
            _atomic_write_text(target, f'{{"v": {value}}}')
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(index,)) for index in range(12)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert not errors
    assert target.read_text(encoding="utf-8").startswith('{"v":')


def test_save_session_serializes_concurrent_updates(tmp_path, monkeypatch):
    project_id = "proj_atomic"
    project_dir = tmp_path / "data" / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir()

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_blank_session(project_id, name="并发保存")
    errors: list[Exception] = []

    def bump_name(suffix: int) -> None:
        try:
            current = service.get_session(project_id, session.id)
            current.name = f"并发-{suffix}"
            service._save_session(project_dir, current)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=bump_name, args=(index,)) for index in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert not errors
    saved = EditSession.model_validate_json(
        (project_dir / "edit_sessions" / f"{session.id}.json").read_text(encoding="utf-8")
    )
    assert saved.name.startswith("并发-")

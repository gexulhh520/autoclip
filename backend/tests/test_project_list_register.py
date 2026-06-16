import json
from pathlib import Path

import pytest

from backend.core.database import get_db, init_database, reset_database
from backend.models.project import Project
from backend.services.data_sync_service import DataSyncService
from backend.services.editor_workspace_service import is_editor_workspace_project
from backend.services.project_service import ProjectService
from backend.schemas.base import PaginationParams


@pytest.fixture(autouse=True)
def setup_database():
    reset_database()
    init_database()
    yield
    reset_database()


def test_register_missing_projects_excludes_editor_workspace(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    project_dir = data_dir / "projects" / "11111111-1111-4111-8111-111111111111"
    clips_dir = project_dir / "output" / "clips"
    clips_dir.mkdir(parents=True)
    (clips_dir / "1_x.mp4").write_bytes(b"x")
    (project_dir / "metadata").mkdir(parents=True, exist_ok=True)
    (project_dir / "metadata" / "clips_metadata.json").write_text(
        json.dumps([{"id": "1", "generated_title": "x"}]),
        encoding="utf-8",
    )
    (project_dir / "output" / "step6_video_output.json").write_text(
        json.dumps({"clips_generated": 1, "clip_paths": ["1_x.mp4"]}),
        encoding="utf-8",
    )

    editor_dir = data_dir / "projects" / "22222222-2222-4222-8222-222222222222"
    (editor_dir / "metadata").mkdir(parents=True)
    (editor_dir / "editor_workspace.json").write_text("{}", encoding="utf-8")

    monkeypatch.setenv("AUTOCLIP_DATA_DIR", str(data_dir))

    db = next(get_db())
    registered = DataSyncService(db).register_missing_projects_from_filesystem(data_dir)
    assert registered == 1

    projects = db.query(Project).all()
    assert len(projects) == 1
    assert str(projects[0].id) == "11111111-1111-4111-8111-111111111111"

    response = ProjectService(db).get_projects_paginated(PaginationParams(page=1, size=20))
    assert response.pagination.total == 1
    assert len(response.items) == 1
    assert not is_editor_workspace_project(projects[0])


def test_ensure_project_registered_single(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    project_id = "33333333-3333-4333-8333-333333333333"
    project_dir = data_dir / "projects" / project_id
    (project_dir / "output").mkdir(parents=True)
    (project_dir / "output" / "step6_video_output.json").write_text(
        json.dumps({"clips_generated": 1, "clip_paths": []}),
        encoding="utf-8",
    )

    monkeypatch.setenv("AUTOCLIP_DATA_DIR", str(data_dir))

    db = next(get_db())
    sync = DataSyncService(db)
    assert sync.ensure_project_registered(project_id) is True
    assert db.query(Project).filter(Project.id == project_id).first() is not None
    assert sync.ensure_project_registered(project_id) is True

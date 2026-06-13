"""剪辑工作台 API 测试。"""
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.services.edit_session_service import EditSessionService
from backend.services.editor_workspace_service import EditorWorkspaceService, is_editor_workspace_project


def test_is_editor_workspace_project():
    project = MagicMock()
    project.processing_config = {"editor_workspace": True}
    assert is_editor_workspace_project(project) is True

    project.processing_config = {}
    assert is_editor_workspace_project(project) is False


def test_editor_workspace_create_blank_draft(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    projects_dir = data_dir / "projects"
    projects_dir.mkdir()

    workspace_project_id = "workspace-proj-001"
    workspace_dir = projects_dir / workspace_project_id
    workspace_dir.mkdir()

    created_projects = []

    class FakeProject:
        def __init__(self, pid: str):
            self.id = pid
            self.processing_config = {"editor_workspace": True}

    class FakeProjectService:
        def get(self, project_id: str):
            if project_id == workspace_project_id:
                return FakeProject(workspace_project_id)
            return None

        def create_project(self, _data):
            created_projects.append(_data)
            return FakeProject(workspace_project_id)

    monkeypatch.setattr(
        "backend.services.editor_workspace_service.get_data_directory",
        lambda: data_dir,
    )
    monkeypatch.setattr(
        "backend.services.editor_workspace_service.get_project_directory",
        lambda pid: projects_dir / pid,
    )

    workspace = EditorWorkspaceService(db=MagicMock())
    workspace.project_service = FakeProjectService()

    pid = workspace.ensure_workspace_project_id()
    assert pid == workspace_project_id
    assert (data_dir / "editor_workspace.json").exists()

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: workspace_dir,
    )
    edit_service = EditSessionService(db=None)
    session = edit_service.create_blank_session(pid)

    assert session.project_id == workspace_project_id
    assert session.sequence == []
    assert (workspace_dir / "edit_sessions" / f"{session.id}.json").exists()

    meta = json.loads((data_dir / "editor_workspace.json").read_text(encoding="utf-8"))
    assert meta["project_id"] == workspace_project_id

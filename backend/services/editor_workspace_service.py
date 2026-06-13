"""剪辑工作台：独立于 AI 切片项目的空白剪辑草稿空间。"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from backend.core.path_utils import get_data_directory, get_project_directory
from backend.schemas.project import ProjectCreate, ProjectType
from backend.services.project_service import ProjectService

logger = logging.getLogger(__name__)

WORKSPACE_META_FILENAME = "editor_workspace.json"


def is_editor_workspace_project(project: Any) -> bool:
    cfg = getattr(project, "processing_config", None) or {}
    return isinstance(cfg, dict) and bool(cfg.get("editor_workspace"))


def _meta_path() -> Path:
    return get_data_directory() / WORKSPACE_META_FILENAME


class EditorWorkspaceService:
    def __init__(self, db: Session):
        self.db = db
        self.project_service = ProjectService(db)

    def _load_meta(self) -> Dict[str, Any]:
        path = _meta_path()
        if not path.exists():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return raw if isinstance(raw, dict) else {}
        except json.JSONDecodeError:
            logger.warning("editor_workspace.json 损坏，将重新创建")
            return {}

    def _save_meta(self, meta: Dict[str, Any]) -> None:
        path = _meta_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    def ensure_workspace_project_id(self) -> str:
        meta = self._load_meta()
        project_id: Optional[str] = meta.get("project_id")
        if project_id:
            project = self.project_service.get(project_id)
            if project and is_editor_workspace_project(project):
                get_project_directory(project_id)
                return project_id

        project = self.project_service.create_project(
            ProjectCreate(
                name="剪辑草稿箱",
                description="视频剪辑独立草稿空间",
                project_type=ProjectType.DEFAULT,
                settings={"editor_workspace": True},
            )
        )
        new_id = str(project.id)
        get_project_directory(new_id)
        self._save_meta({"project_id": new_id})
        logger.info("已创建剪辑工作台项目: %s", new_id)
        return new_id

"""独立视频剪辑工作台 API。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.schemas.edit_session import (
    EditSession,
    EditSessionBlankCreateResponse,
    EditSessionListResponse,
)
from backend.services.edit_session_service import EditSessionService
from backend.services.editor_workspace_service import EditorWorkspaceService

logger = logging.getLogger(__name__)

router = APIRouter()


def get_workspace_service(db: Session = Depends(get_db)) -> EditorWorkspaceService:
    return EditorWorkspaceService(db)


def get_edit_session_service(db: Session = Depends(get_db)) -> EditSessionService:
    return EditSessionService(db=db)


@router.post("/drafts/blank", response_model=EditSessionBlankCreateResponse)
async def create_blank_draft(
    workspace: EditorWorkspaceService = Depends(get_workspace_service),
    edit_service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        project_id = workspace.ensure_workspace_project_id()
        session = edit_service.create_blank_session(project_id)
        return EditSessionBlankCreateResponse(session=session)
    except Exception as exc:
        logger.exception("创建剪辑草稿失败")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/drafts", response_model=EditSessionListResponse)
async def list_drafts(
    workspace: EditorWorkspaceService = Depends(get_workspace_service),
    edit_service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        project_id = workspace.ensure_workspace_project_id()
        return EditSessionListResponse(sessions=edit_service.list_sessions(project_id))
    except Exception as exc:
        logger.exception("列出剪辑草稿失败")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/drafts/{session_id}", response_model=EditSession)
async def get_draft(
    session_id: str,
    workspace: EditorWorkspaceService = Depends(get_workspace_service),
    edit_service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        project_id = workspace.ensure_workspace_project_id()
        return edit_service.get_session(project_id, session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="草稿不存在") from exc
    except Exception as exc:
        logger.exception("获取剪辑草稿失败: %s", session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/export-directory/default")
async def get_default_export_directory():
    from backend.utils.export_local import get_default_editor_export_dir

    path = get_default_editor_export_dir()
    return {"path": str(path)}


@router.post("/export-directory/validate")
async def validate_export_directory(body: dict):
    from pathlib import Path

    raw_path = body.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail="请提供有效的目录路径")

    path = Path(raw_path.strip()).expanduser()
    try:
        resolved = path.resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="目录路径无效") from exc

    if not resolved.exists():
        raise HTTPException(status_code=400, detail="目录不存在")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="路径不是目录")

    return {"path": str(resolved), "valid": True}

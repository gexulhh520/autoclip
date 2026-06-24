"""独立视频剪辑工作台 API。"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.schemas.edit_session import (
    EditSession,
    EditSessionBlankCreateResponse,
    EditSessionListResponse,
    HeadlessExportCompleteRequest,
    HeadlessExportFailRequest,
    HeadlessExportJobItemResponse,
    HeadlessExportJobsResponse,
    HeadlessExportPendingResponse,
    HeadlessExportProgressRequest,
)
from backend.services.edit_session_service import EditSessionService
from backend.services.editor_workspace_service import EditorWorkspaceService

logger = logging.getLogger(__name__)

router = APIRouter()


def _headless_job_response(item) -> HeadlessExportJobItemResponse:
    return HeadlessExportJobItemResponse(
        job_id=item.job_id,
        project_id=item.project_id,
        session_id=item.session_id,
        filename=item.filename,
        burn_subtitles=item.burn_subtitles,
        export_srt=item.export_srt,
        use_source_video=item.use_source_video,
        output_dir=item.output_dir,
        plan_path=item.plan_path,
        status=item.status,
        progress=item.progress,
        message=item.message,
        error=item.error,
        local_output_path=item.local_output_path,
        local_srt_path=item.local_srt_path,
        updated_at=item.updated_at,
    )


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
        session = await asyncio.to_thread(edit_service.create_blank_session, project_id)
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


@router.get("/headless-export/pending", response_model=HeadlessExportPendingResponse)
async def list_pending_headless_exports(limit: int = 20):
    from backend.services.headless_export_service import list_pending_headless_jobs

    jobs = list_pending_headless_jobs(limit=max(1, min(limit, 50)))
    return HeadlessExportPendingResponse(jobs=[_headless_job_response(item) for item in jobs])


@router.get("/headless-export/jobs", response_model=HeadlessExportJobsResponse)
async def list_headless_export_jobs(limit: int = 20, active_only: bool = False):
    from backend.services.headless_export_service import list_headless_export_jobs

    jobs = list_headless_export_jobs(
        limit=max(1, min(limit, 50)),
        active_only=active_only,
    )
    return HeadlessExportJobsResponse(jobs=[_headless_job_response(item) for item in jobs])


@router.post(
    "/headless-export/{project_id}/{session_id}/{job_id}/claim",
    response_model=HeadlessExportJobItemResponse,
)
async def claim_headless_export_job(project_id: str, session_id: str, job_id: str):
    from backend.services.headless_export_service import claim_headless_job

    try:
        item = claim_headless_job(project_id, session_id, job_id)
        return _headless_job_response(item)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Headless 任务不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/headless-export/{project_id}/{session_id}/{job_id}/progress")
async def report_headless_export_progress(
    project_id: str,
    session_id: str,
    job_id: str,
    body: HeadlessExportProgressRequest,
):
    from backend.services.headless_export_service import update_headless_job_progress

    try:
        update_headless_job_progress(
            project_id,
            session_id,
            job_id,
            progress=body.progress,
            message=body.message,
        )
        return {"success": True}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Headless 任务不存在") from exc


@router.post("/headless-export/{project_id}/{session_id}/{job_id}/complete")
async def complete_headless_export_job(
    project_id: str,
    session_id: str,
    job_id: str,
    body: HeadlessExportCompleteRequest,
):
    from backend.services.headless_export_service import complete_headless_job

    try:
        complete_headless_job(
            project_id,
            session_id,
            job_id,
            output_path=body.output_path,
            download_url=body.download_url,
            local_output_path=body.local_output_path,
            srt_path=body.srt_path,
            srt_download_url=body.srt_download_url,
            local_srt_path=body.local_srt_path,
        )
        return {"success": True}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Headless 任务不存在") from exc


@router.post("/headless-export/{project_id}/{session_id}/{job_id}/fail")
async def fail_headless_export_job(
    project_id: str,
    session_id: str,
    job_id: str,
    body: HeadlessExportFailRequest,
):
    from backend.services.headless_export_service import fail_headless_job

    try:
        fail_headless_job(project_id, session_id, job_id, error=body.error)
        return {"success": True}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Headless 任务不存在") from exc

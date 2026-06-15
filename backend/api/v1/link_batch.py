"""多链接单项目下载 API。"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.link_batch_download_service import (
    create_link_batch_project,
    get_link_batch_task,
    process_link_batch_download,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class LinkBatchDownloadRequest(BaseModel):
    urls: List[str] = Field(min_length=1, description="视频链接列表（B 站 / YouTube）")
    project_name: str = Field(default="多链接项目")
    video_category: Optional[str] = "knowledge"
    clip_duration_preset: Optional[str] = "standard"
    clip_min_seconds: Optional[int] = None
    clip_target_seconds: Optional[int] = None
    clip_max_seconds: Optional[int] = None
    clip_goal: Optional[str] = "knowledge"
    template_id: Optional[str] = None
    browser: Optional[str] = None


class LinkBatchDownloadTaskResponse(BaseModel):
    id: str
    project_id: str
    project_name: str
    total_urls: int
    status: str
    progress: float
    message: str
    completed_urls: int = 0
    current_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    updated_at: str


@router.post("/download", response_model=LinkBatchDownloadTaskResponse)
async def create_link_batch_download_task(body: LinkBatchDownloadRequest):
    """多个视频链接 → 单个多源项目，按顺序下载后串行分析。"""
    try:
        task, meta = await create_link_batch_project(
            urls_raw=body.urls,
            project_name=body.project_name,
            video_category=body.video_category,
            clip_duration_preset=body.clip_duration_preset,
            clip_min_seconds=body.clip_min_seconds,
            clip_target_seconds=body.clip_target_seconds,
            clip_max_seconds=body.clip_max_seconds,
            clip_goal=body.clip_goal,
            template_id=body.template_id,
            browser=body.browser,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("创建多链接项目失败")
        raise HTTPException(status_code=500, detail="创建多链接项目失败") from exc

    from backend.api.v1.async_task_manager import task_manager

    await task_manager.create_safe_task(
        f"link_batch_download_{task.id}",
        process_link_batch_download,
        task.id,
        browser=meta["browser"],
        sources=meta["sources"],
    )

    return LinkBatchDownloadTaskResponse(**task.to_dict())


@router.get("/tasks/{task_id}", response_model=LinkBatchDownloadTaskResponse)
async def get_link_batch_download_task(task_id: str):
    task = get_link_batch_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return LinkBatchDownloadTaskResponse(**task.to_dict())

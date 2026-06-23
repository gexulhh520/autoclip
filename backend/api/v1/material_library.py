"""全局素材库 API（桌面端）。"""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.services.material_download_service import (
    cancel_download_task,
    count_active_downloads,
    create_download_from_url,
    create_download_tasks,
    delete_download_task,
    get_download_task,
    list_download_tasks,
    retry_download_task,
)
from backend.services.material_library_service import (
    delete_library_asset,
    get_library_asset,
    import_local_file_to_library,
    import_local_upload_to_library,
    list_library_assets,
    resolve_library_thumbnail_path,
    resolve_library_video_path,
)
from backend.services.material_search_service import search_materials

logger = logging.getLogger(__name__)

router = APIRouter()


class MaterialSearchRequest(BaseModel):
    platform: str = Field(..., description="youtube 或 bilibili")
    query: str = Field(..., min_length=1, max_length=200)
    limit: int = Field(default=20, ge=1, le=50)
    browser: Optional[str] = None


class MaterialDownloadItem(BaseModel):
    platform: str
    url: str
    title: Optional[str] = None
    external_id: Optional[str] = None
    thumbnail: Optional[str] = None
    duration_sec: Optional[int] = None
    uploader: Optional[str] = None


class MaterialDownloadCreateRequest(BaseModel):
    items: List[MaterialDownloadItem]
    search_query: Optional[str] = None
    browser: Optional[str] = None


class MaterialDownloadFromUrlRequest(BaseModel):
    url: str = Field(..., min_length=1)
    browser: Optional[str] = None


class MaterialImportPathRequest(BaseModel):
    source_path: str = Field(..., min_length=1)
    title: Optional[str] = None


@router.get("/assets")
async def list_material_library_assets(
    q: Optional[str] = Query(default=None),
    origin: Optional[str] = Query(default=None),
    platform: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    sort: str = Query(default="created_at_desc"),
):
    return list_library_assets(
        q=q,
        origin=origin,
        platform=platform,
        page=page,
        page_size=page_size,
        sort=sort,
    )


@router.get("/assets/{asset_id}")
async def get_material_library_asset(asset_id: str):
    asset = get_library_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="素材不存在")
    return asset


@router.get("/assets/{asset_id}/video")
async def stream_material_library_video(asset_id: str):
    path = resolve_library_video_path(asset_id)
    if path is None:
        raise HTTPException(status_code=404, detail="素材不存在")
    return FileResponse(
        path=str(path.resolve()),
        media_type="video/mp4",
        filename=path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/assets/{asset_id}/thumbnail")
async def stream_material_library_thumbnail(asset_id: str):
    path = resolve_library_thumbnail_path(asset_id)
    if path is None:
        raise HTTPException(status_code=404, detail="缩略图不存在")
    media_type = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    return FileResponse(path=str(path.resolve()), media_type=media_type)


@router.delete("/assets/{asset_id}")
async def remove_material_library_asset(asset_id: str):
    try:
        delete_library_asset(asset_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("删除素材库条目失败: %s", asset_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/assets/import-path")
async def import_material_library_from_path(body: MaterialImportPathRequest):
    try:
        asset = import_local_file_to_library(body.source_path, body.title)
        return {"ok": True, "asset": asset}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("本地路径导入素材库失败")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/assets/import-upload")
async def import_material_library_upload(
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
):
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="缺少文件名")
        content = await file.read()
        asset = import_local_upload_to_library(file.filename, content, title)
        return {"ok": True, "asset": asset}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("上传导入素材库失败")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/search")
async def search_material_library(body: MaterialSearchRequest):
    try:
        loop = asyncio.get_event_loop()
        items = await loop.run_in_executor(
            None,
            lambda: search_materials(
                body.platform,
                body.query,
                body.limit,
                body.browser,
            ),
        )
        return {"items": items, "query": body.query, "platform": body.platform}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("素材搜索失败: %s", body.query)
        raise HTTPException(status_code=500, detail=f"搜索失败: {exc}") from exc


@router.post("/downloads")
async def create_material_download_tasks(body: MaterialDownloadCreateRequest):
    try:
        payload = [item.model_dump() for item in body.items]
        tasks = create_download_tasks(
            payload,
            search_query=body.search_query,
            browser=body.browser,
        )
        if not tasks:
            raise HTTPException(status_code=400, detail="没有可创建的下载任务（可能已在库中或队列中）")
        return {"items": tasks}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("创建素材下载任务失败")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/downloads/from-url")
async def create_material_download_from_url(body: MaterialDownloadFromUrlRequest):
    try:
        loop = asyncio.get_event_loop()
        tasks = await loop.run_in_executor(
            None,
            lambda: create_download_from_url(body.url, browser=body.browser),
        )
        if not tasks:
            raise HTTPException(status_code=400, detail="没有可创建的下载任务（可能已在库中或队列中）")
        return {"items": tasks}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("从链接创建素材下载任务失败")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/downloads")
async def list_material_download_tasks(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
):
    items = list_download_tasks(status=status, limit=limit)
    return {"items": items, "active_count": count_active_downloads()}


@router.get("/downloads/{task_id}")
async def get_material_download_task(task_id: str):
    task = get_download_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="下载任务不存在")
    return task


@router.post("/downloads/{task_id}/retry")
async def retry_material_download_task(task_id: str):
    try:
        return retry_download_task(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("重试下载任务失败: %s", task_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/downloads/{task_id}/cancel")
async def cancel_material_download_task(task_id: str):
    try:
        return cancel_download_task(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("取消下载任务失败: %s", task_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/downloads/{task_id}")
async def remove_material_download_task(task_id: str):
    try:
        delete_download_task(task_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("删除下载任务失败: %s", task_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

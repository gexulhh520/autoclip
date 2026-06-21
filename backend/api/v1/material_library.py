"""全局素材库 API（桌面端）。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.services.material_library_service import (
    delete_library_asset,
    get_library_asset,
    list_library_assets,
    resolve_library_video_path,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/assets")
async def list_material_library_assets():
    return {"items": list_library_assets()}


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

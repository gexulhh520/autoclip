"""基因模板 API。"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.pipeline.template_engine import (
    DEFAULT_TEMPLATE_ID,
    TEMPLATES_DIR,
    TemplateNotFoundError,
    get_template_engine,
)
from backend.schemas.template import (
    GeneTemplateDetailResponse,
    GeneTemplateListResponse,
)

router = APIRouter()

ASSETS_DIR = TEMPLATES_DIR / "assets"
_ASSET_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")


@router.get("/assets/{asset_name}")
async def get_template_asset(asset_name: str):
    """获取模板预览静态资源（SVG 封面等）。"""
    if not _ASSET_NAME_PATTERN.match(asset_name):
        raise HTTPException(status_code=400, detail="Invalid asset name")

    asset_path = ASSETS_DIR / asset_name
    if not asset_path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")

    media_type = "image/svg+xml" if asset_name.endswith(".svg") else None
    if asset_name.endswith(".mp4"):
        media_type = "video/mp4"
    elif asset_name.endswith(".webm"):
        media_type = "video/webm"
    return FileResponse(asset_path, media_type=media_type)


@router.get("", response_model=GeneTemplateListResponse)
async def list_templates():
    """获取可用基因模板列表（模板广场）。"""
    engine = get_template_engine()
    templates = [engine.to_summary(t) for t in engine.list_templates()]
    default_id = DEFAULT_TEMPLATE_ID if any(t.id == DEFAULT_TEMPLATE_ID for t in templates) else (
        templates[0].id if templates else None
    )
    return GeneTemplateListResponse(templates=templates, default_template=default_id)


@router.get("/{template_id}", response_model=GeneTemplateDetailResponse)
async def get_template_detail(template_id: str):
    """获取单个模板详情及解析后的 Pipeline 设置预览。"""
    engine = get_template_engine()
    try:
        template = engine.get_template(template_id)
    except TemplateNotFoundError:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")

    return GeneTemplateDetailResponse(
        template=template,
        resolved_settings=engine.resolve_processing_settings(template_id),
    )

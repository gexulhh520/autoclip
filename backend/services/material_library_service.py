"""桌面全局素材库：DB 索引 + 本地文件存储。"""
from __future__ import annotations

import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.database import SessionLocal
from backend.core.path_utils import get_data_directory
from backend.models.material_library import MaterialAssetOrigin, MaterialFileStatus, MaterialLibraryAsset
from backend.repositories.material_library_repository import MaterialLibraryRepository
from backend.services.material_library_migration import migrate_legacy_assets_json_if_needed
from backend.services.session_clip_pool_service import (
    get_session_pool_clip,
    mark_session_pool_clip_promoted,
    resolve_session_pool_video_path,
)

logger = logging.getLogger(__name__)

_initialized = False


def _library_root() -> Path:
    root = get_data_directory() / "material_library"
    root.mkdir(parents=True, exist_ok=True)
    (root / "videos").mkdir(parents=True, exist_ok=True)
    (root / "thumbs").mkdir(parents=True, exist_ok=True)
    return root


def ensure_material_library_initialized() -> None:
    global _initialized
    if _initialized:
        return
    _library_root()
    migrate_legacy_assets_json_if_needed()
    _initialized = True


def asset_to_dict(asset: MaterialLibraryAsset) -> Dict[str, Any]:
    metadata = asset.asset_metadata if isinstance(asset.asset_metadata, dict) else {}
    return {
        "id": asset.id,
        "title": asset.title,
        "video_path": asset.video_path,
        "thumbnail_path": asset.thumbnail_path,
        "origin": asset.origin.value if asset.origin else None,
        "platform": asset.platform,
        "external_id": asset.external_id,
        "source_url": asset.source_url,
        "duration_sec": asset.duration_sec,
        "file_size_bytes": asset.file_size_bytes,
        "uploader": asset.uploader,
        "upload_date": asset.upload_date,
        "view_count": asset.view_count,
        "search_query": asset.search_query,
        "source_project_id": asset.source_project_id,
        "source_session_id": asset.source_session_id,
        "source_clip_id": asset.source_clip_id,
        "promoted_at": asset.created_at.isoformat() if asset.created_at else None,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
        "metadata": metadata,
    }


def list_library_assets(
    *,
    q: Optional[str] = None,
    origin: Optional[str] = None,
    platform: Optional[str] = None,
    page: int = 1,
    page_size: int = 24,
    sort: str = "created_at_desc",
) -> Dict[str, Any]:
    ensure_material_library_initialized()
    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        parsed_origin = None
        if origin:
            try:
                parsed_origin = MaterialAssetOrigin(origin)
            except ValueError:
                pass
        items, total = repo.search_assets(
            q=q,
            origin=parsed_origin,
            platform=platform,
            page=page,
            page_size=page_size,
            sort=sort,
        )
        meta = MaterialLibraryRepository.paginate_meta(total, page, page_size)
        return {
            "items": [asset_to_dict(item) for item in items],
            **meta,
        }
    finally:
        db.close()


def get_library_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    ensure_material_library_initialized()
    db = SessionLocal()
    try:
        asset = MaterialLibraryRepository(db).get_by_id(asset_id)
        return asset_to_dict(asset) if asset else None
    finally:
        db.close()


def resolve_library_video_path(asset_id: str) -> Optional[Path]:
    row = get_library_asset(asset_id)
    if not row:
        return None
    rel = str(row.get("video_path") or "").strip()
    if not rel:
        return None
    path = get_data_directory() / rel
    return path if path.exists() else None


def resolve_library_thumbnail_path(asset_id: str) -> Optional[Path]:
    row = get_library_asset(asset_id)
    if not row:
        return None
    rel = str(row.get("thumbnail_path") or "").strip()
    if not rel:
        return None
    path = get_data_directory() / rel
    return path if path.exists() else None


def is_clip_protected_in_library(
    project_id: str, session_id: str, clip_id: str
) -> bool:
    ensure_material_library_initialized()
    db = SessionLocal()
    try:
        rows = (
            db.query(MaterialLibraryAsset)
            .filter(
                MaterialLibraryAsset.source_project_id == str(project_id),
                MaterialLibraryAsset.source_session_id == str(session_id),
                MaterialLibraryAsset.source_clip_id == str(clip_id),
                MaterialLibraryAsset.file_status == MaterialFileStatus.READY,
            )
            .count()
        )
        return rows > 0
    finally:
        db.close()


def promote_session_clip_to_library(
    project_id: str,
    session_id: str,
    clip_id: str,
) -> Dict[str, Any]:
    ensure_material_library_initialized()
    row = get_session_pool_clip(project_id, session_id, clip_id)
    if row is None:
        raise ValueError(f"草稿素材不存在: {clip_id}")

    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        if row.get("in_library") and row.get("library_asset_id"):
            existing = repo.get_by_id(str(row["library_asset_id"]))
            if existing and existing.file_status == MaterialFileStatus.READY:
                return asset_to_dict(existing)

        for asset in db.query(MaterialLibraryAsset).filter(
            MaterialLibraryAsset.source_project_id == str(project_id),
            MaterialLibraryAsset.source_session_id == str(session_id),
            MaterialLibraryAsset.source_clip_id == str(clip_id),
            MaterialLibraryAsset.file_status == MaterialFileStatus.READY,
        ):
            mark_session_pool_clip_promoted(project_id, session_id, clip_id, asset.id)
            return asset_to_dict(asset)
    finally:
        db.close()

    source_path = resolve_session_pool_video_path(project_id, session_id, clip_id)
    if source_path is None or not source_path.exists():
        raise ValueError("素材视频文件不存在，无法收藏")

    asset_id = f"lib-{uuid.uuid4().hex[:12]}"
    dest_rel = f"material_library/videos/{asset_id}.mp4"
    dest_path = get_data_directory() / dest_rel
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, dest_path)

    title = str(
        row.get("generated_title") or row.get("outline") or row.get("title") or clip_id
    ).strip()
    metadata = {
        "recommend_reason": row.get("recommend_reason"),
        "match_score": row.get("match_score"),
        "source": row.get("source"),
    }

    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        asset = repo.create(
            id=asset_id,
            title=title[:255],
            origin=MaterialAssetOrigin.SESSION_POOL,
            video_path=dest_rel,
            source_project_id=project_id,
            source_session_id=session_id,
            source_clip_id=clip_id,
            asset_metadata=metadata,
            file_status=MaterialFileStatus.READY,
            file_size_bytes=dest_path.stat().st_size if dest_path.exists() else None,
        )
        mark_session_pool_clip_promoted(project_id, session_id, clip_id, asset_id)
        return asset_to_dict(asset)
    finally:
        db.close()


def delete_library_asset(asset_id: str) -> None:
    ensure_material_library_initialized()
    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        asset = repo.get_by_id(asset_id)
        if asset is None:
            raise ValueError(f"素材库条目不存在: {asset_id}")

        for rel in (asset.video_path, asset.thumbnail_path):
            if not rel:
                continue
            file_path = get_data_directory() / rel
            if file_path.exists():
                try:
                    file_path.unlink()
                except OSError as exc:
                    logger.warning("删除素材库文件失败 %s: %s", file_path, exc)
        repo.delete(asset_id)
    finally:
        db.close()

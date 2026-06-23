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
from backend.services.material_library_fts import backfill_material_library_fts, normalize_tags
from backend.services.material_library_migration import migrate_legacy_assets_json_if_needed
from backend.services.session_clip_pool_service import (
    get_session_pool_clip,
    mark_session_pool_clip_promoted,
    resolve_session_pool_video_path,
)

logger = logging.getLogger(__name__)

_LOCAL_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}

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
    db = SessionLocal()
    try:
        backfill_material_library_fts(db)
    finally:
        db.close()
    _initialized = True


def asset_to_dict(asset: MaterialLibraryAsset) -> Dict[str, Any]:
    metadata = asset.asset_metadata if isinstance(asset.asset_metadata, dict) else {}
    tags = asset.tags if isinstance(asset.tags, list) else []
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
        "tags": normalize_tags(tags),
        "promoted_at": asset.created_at.isoformat() if asset.created_at else None,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
        "metadata": metadata,
    }


def list_library_assets(
    *,
    q: Optional[str] = None,
    tags: Optional[List[str]] = None,
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
            tags=normalize_tags(tags) if tags else None,
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


def import_library_asset_to_session(
    project_id: str,
    session_id: str,
    asset_id: str,
    *,
    insert_index: Optional[int] = None,
):
    from backend.services.edit_session_service import EditSessionService

    path = resolve_library_video_path(asset_id)
    if path is None:
        raise ValueError(f"素材不存在或文件缺失: {asset_id}")

    asset_meta = get_library_asset(asset_id)

    db = SessionLocal()
    try:
        service = EditSessionService(db)
        session, block, import_method = service.import_media_from_path(
            project_id,
            session_id,
            str(path.resolve()),
            insert_index=insert_index,
            title=str(asset_meta["title"]) if asset_meta and asset_meta.get("title") else None,
        )
        return session, block, import_method
    finally:
        db.close()


def import_local_file_to_library(
    source_path: str,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_material_library_initialized()
    raw = (source_path or "").strip()
    if not raw:
        raise ValueError("source_path 不能为空")

    source = Path(raw).expanduser()
    try:
        source = source.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(f"视频文件不存在: {raw}") from exc
    if not source.is_file():
        raise ValueError("路径不是有效视频文件")
    if source.stat().st_size <= 0:
        raise ValueError("视频文件为空")

    suffix = source.suffix.lower()
    if suffix not in _LOCAL_VIDEO_SUFFIXES:
        raise ValueError(f"不支持的视频格式: {suffix or '(无扩展名)'}")

    asset_id = f"lib-{uuid.uuid4().hex[:12]}"
    dest_rel = f"material_library/videos/{asset_id}{suffix}"
    dest_path = get_data_directory() / dest_rel
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest_path)

    entry_title = str(title or source.stem or asset_id).strip()[:255]
    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        asset = repo.create(
            id=asset_id,
            title=entry_title,
            origin=MaterialAssetOrigin.LOCAL_IMPORT,
            platform="local",
            external_id=None,
            source_url=None,
            video_path=dest_rel,
            file_size_bytes=dest_path.stat().st_size if dest_path.exists() else None,
            file_status=MaterialFileStatus.READY,
        )
        return asset_to_dict(asset)
    finally:
        db.close()


def import_local_upload_to_library(
    file_name: str,
    content: bytes,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    if not content:
        raise ValueError("视频文件为空")
    suffix = Path(file_name).suffix.lower()
    if suffix not in _LOCAL_VIDEO_SUFFIXES:
        raise ValueError(f"不支持的视频格式: {suffix or '(无扩展名)'}")

    ensure_material_library_initialized()
    asset_id = f"lib-{uuid.uuid4().hex[:12]}"
    dest_rel = f"material_library/videos/{asset_id}{suffix}"
    dest_path = get_data_directory() / dest_rel
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_bytes(content)

    entry_title = str(title or Path(file_name).stem or asset_id).strip()[:255]
    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        asset = repo.create(
            id=asset_id,
            title=entry_title,
            origin=MaterialAssetOrigin.LOCAL_IMPORT,
            platform="local",
            video_path=dest_rel,
            file_size_bytes=dest_path.stat().st_size if dest_path.exists() else None,
            file_status=MaterialFileStatus.READY,
        )
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
        if not repo.delete(asset_id):
            raise ValueError(f"素材库条目不存在: {asset_id}")
    finally:
        db.close()


def delete_library_assets_batch(asset_ids: List[str]) -> Dict[str, Any]:
    ensure_material_library_initialized()
    deleted: List[str] = []
    errors: List[Dict[str, str]] = []
    for asset_id in asset_ids:
        asset_key = str(asset_id or "").strip()
        if not asset_key:
            continue
        try:
            delete_library_asset(asset_key)
            deleted.append(asset_key)
        except ValueError as exc:
            errors.append({"id": asset_key, "error": str(exc)})
        except Exception as exc:
            logger.exception("批量删除素材失败: %s", asset_key)
            errors.append({"id": asset_key, "error": str(exc)})
    return {"deleted": deleted, "errors": errors}


def update_library_asset_tags(asset_id: str, tags: List[str]) -> Dict[str, Any]:
    ensure_material_library_initialized()
    normalized = normalize_tags(tags)
    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        asset = repo.update(asset_id, tags=normalized)
        if asset is None:
            raise ValueError(f"素材库条目不存在: {asset_id}")
        return asset_to_dict(asset)
    finally:
        db.close()


def list_library_tags(*, limit: int = 100) -> List[str]:
    ensure_material_library_initialized()
    db = SessionLocal()
    try:
        return MaterialLibraryRepository(db).list_distinct_tags(limit=limit)
    finally:
        db.close()


def get_library_storage_stats() -> Dict[str, Any]:
    ensure_material_library_initialized()
    db = SessionLocal()
    try:
        rows = (
            db.query(
                MaterialLibraryAsset.origin,
                MaterialLibraryAsset.platform,
                MaterialLibraryAsset.file_size_bytes,
            )
            .filter(MaterialLibraryAsset.file_status == MaterialFileStatus.READY)
            .all()
        )
    finally:
        db.close()

    total_assets = len(rows)
    total_bytes = 0
    by_origin: Dict[str, Dict[str, int]] = {}
    by_platform: Dict[str, Dict[str, int]] = {}

    for origin, platform, file_size_bytes in rows:
        size = int(file_size_bytes or 0)
        total_bytes += size
        origin_key = origin.value if origin else "unknown"
        platform_key = str(platform or "unknown")
        for bucket, key in ((by_origin, origin_key), (by_platform, platform_key)):
            entry = bucket.setdefault(key, {"count": 0, "bytes": 0})
            entry["count"] += 1
            entry["bytes"] += size

    library_root = _library_root()
    thumb_bytes = 0
    thumbs_dir = library_root / "thumbs"
    if thumbs_dir.exists():
        for path in thumbs_dir.iterdir():
            if path.is_file():
                try:
                    thumb_bytes += path.stat().st_size
                except OSError:
                    pass

    return {
        "total_assets": total_assets,
        "total_bytes": total_bytes,
        "video_bytes": total_bytes,
        "thumbnail_bytes": thumb_bytes,
        "disk_bytes": total_bytes + thumb_bytes,
        "by_origin": by_origin,
        "by_platform": by_platform,
    }

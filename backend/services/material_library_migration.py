"""将 legacy assets.json 迁移到 SQLite。"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from backend.core.database import SessionLocal
from backend.core.path_utils import get_data_directory
from backend.models.material_library import MaterialAssetOrigin, MaterialFileStatus, MaterialLibraryAsset
from backend.repositories.material_library_repository import MaterialLibraryRepository

logger = logging.getLogger(__name__)

MIGRATION_MARKER = ".migrated_from_json"


def _library_root() -> Path:
    root = get_data_directory() / "material_library"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _legacy_index_path() -> Path:
    return _library_root() / "assets.json"


def migrate_legacy_assets_json_if_needed() -> int:
    marker = _library_root() / MIGRATION_MARKER
    if marker.exists():
        return 0

    legacy_path = _legacy_index_path()
    if not legacy_path.exists():
        marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
        return 0

    try:
        raw = json.loads(legacy_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("读取 legacy assets.json 失败，跳过迁移: %s", exc)
        marker.write_text("failed", encoding="utf-8")
        return 0

    if not isinstance(raw, list):
        marker.write_text("empty", encoding="utf-8")
        return 0

    db = SessionLocal()
    migrated = 0
    try:
        repo = MaterialLibraryRepository(db)
        for item in raw:
            if not isinstance(item, dict):
                continue
            asset_id = str(item.get("id") or "").strip()
            if not asset_id or repo.get_by_id(asset_id):
                continue
            video_path = str(item.get("video_path") or "").strip()
            if not video_path:
                continue
            promoted_at = item.get("promoted_at")
            created_at = None
            if promoted_at:
                try:
                    created_at = datetime.fromisoformat(str(promoted_at).replace("Z", "+00:00"))
                except ValueError:
                    created_at = None
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            asset = MaterialLibraryAsset(
                id=asset_id,
                title=str(item.get("title") or asset_id)[:255],
                origin=MaterialAssetOrigin.SESSION_POOL,
                platform=None,
                external_id=None,
                source_url=None,
                video_path=video_path,
                thumbnail_path=None,
                duration_sec=None,
                file_size_bytes=None,
                uploader=None,
                source_project_id=item.get("source_project_id"),
                source_session_id=item.get("source_session_id"),
                source_clip_id=item.get("source_clip_id"),
                asset_metadata=metadata,
                file_status=MaterialFileStatus.READY,
            )
            if created_at is not None:
                asset.created_at = created_at
                asset.updated_at = created_at
            db.add(asset)
            migrated += 1
        db.commit()
        backup = legacy_path.with_suffix(".json.bak")
        if not backup.exists():
            legacy_path.rename(backup)
        marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
        logger.info("素材库 JSON 迁移完成，导入 %s 条", migrated)
    except Exception:
        db.rollback()
        logger.exception("素材库 JSON 迁移失败")
        raise
    finally:
        db.close()
    return migrated

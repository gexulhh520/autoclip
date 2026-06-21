"""桌面全局素材库：从草稿 AI 素材收藏，跨草稿复用。"""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.path_utils import get_data_directory
from backend.services.session_clip_pool_service import (
    get_session_pool_clip,
    mark_session_pool_clip_promoted,
    resolve_session_pool_video_path,
)

logger = logging.getLogger(__name__)


def _library_root() -> Path:
    root = get_data_directory() / "material_library"
    root.mkdir(parents=True, exist_ok=True)
    (root / "videos").mkdir(parents=True, exist_ok=True)
    return root


def _library_index_path() -> Path:
    return _library_root() / "assets.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_assets() -> List[Dict[str, Any]]:
    path = _library_index_path()
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("读取素材库索引失败: %s", exc)
        return []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _save_assets(entries: List[Dict[str, Any]]) -> None:
    path = _library_index_path()
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def list_library_assets() -> List[Dict[str, Any]]:
    assets = _load_assets()
    assets.sort(key=lambda item: str(item.get("promoted_at") or ""), reverse=True)
    return assets


def get_library_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    for row in _load_assets():
        if str(row.get("id") or "") == str(asset_id):
            return row
    return None


def resolve_library_video_path(asset_id: str) -> Optional[Path]:
    row = get_library_asset(asset_id)
    if not row:
        return None
    rel = str(row.get("video_path") or "").strip()
    if not rel:
        return None
    path = get_data_directory() / rel
    return path if path.exists() else None


def is_clip_protected_in_library(
    project_id: str, session_id: str, clip_id: str
) -> bool:
    for row in _load_assets():
        if (
            str(row.get("source_project_id") or "") == str(project_id)
            and str(row.get("source_session_id") or "") == str(session_id)
            and str(row.get("source_clip_id") or "") == str(clip_id)
        ):
            return True
    return False


def promote_session_clip_to_library(
    project_id: str,
    session_id: str,
    clip_id: str,
) -> Dict[str, Any]:
    row = get_session_pool_clip(project_id, session_id, clip_id)
    if row is None:
        raise ValueError(f"草稿素材不存在: {clip_id}")
    if row.get("in_library") and row.get("library_asset_id"):
        existing = get_library_asset(str(row["library_asset_id"]))
        if existing:
            return existing

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
    entry: Dict[str, Any] = {
        "id": asset_id,
        "title": title[:120],
        "video_path": dest_rel,
        "source_project_id": project_id,
        "source_session_id": session_id,
        "source_clip_id": clip_id,
        "promoted_at": _utc_now_iso(),
        "metadata": {
            "recommend_reason": row.get("recommend_reason"),
            "match_score": row.get("match_score"),
            "source": row.get("source"),
        },
    }
    assets = _load_assets()
    assets.append(entry)
    _save_assets(assets)
    mark_session_pool_clip_promoted(project_id, session_id, clip_id, asset_id)
    return entry


def delete_library_asset(asset_id: str) -> None:
    assets = _load_assets()
    target = next((item for item in assets if str(item.get("id")) == str(asset_id)), None)
    if target is None:
        raise ValueError(f"素材库条目不存在: {asset_id}")
    rel = str(target.get("video_path") or "").strip()
    if rel:
        file_path = get_data_directory() / rel
        if file_path.exists():
            try:
                file_path.unlink()
            except OSError as exc:
                logger.warning("删除素材库视频失败 %s: %s", file_path, exc)
    _save_assets([item for item in assets if str(item.get("id")) != str(asset_id)])

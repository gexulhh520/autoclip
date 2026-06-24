"""草稿（EditSession）级 AI 素材池：与项目全局 output/clips 分离。"""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.path_utils import get_project_directory

logger = logging.getLogger(__name__)

POOL_SCOPE = "session"
POOL_SOURCE = "moment_search"
POOL_SOURCE_PIPELINE = "pipeline"


def session_pool_dir(project_dir: Path, session_id: str) -> Path:
    return project_dir / "edit_sessions" / session_id / "pool"


def session_pool_metadata_path(project_dir: Path, session_id: str) -> Path:
    return session_pool_dir(project_dir, session_id) / "clips.json"


def _load_json_list(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("读取 session 素材池失败 %s: %s", path, exc)
        return []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _save_json_list(path: Path, entries: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def list_session_pool_clips(project_id: str, session_id: str) -> List[Dict[str, Any]]:
    project_dir = get_project_directory(project_id)
    return _load_json_list(session_pool_metadata_path(project_dir, session_id))


def get_session_pool_clip(
    project_id: str, session_id: str, clip_id: str
) -> Optional[Dict[str, Any]]:
    for row in list_session_pool_clips(project_id, session_id):
        if str(row.get("id") or "") == str(clip_id):
            return row
    return None


def resolve_session_pool_video_path(
    project_id: str, session_id: str, clip_id: str
) -> Optional[Path]:
    row = get_session_pool_clip(project_id, session_id, clip_id)
    if not row:
        return None
    project_dir = get_project_directory(project_id)
    rel = str(row.get("video_path") or "").strip()
    if not rel:
        return None
    path = project_dir / rel
    return path if path.exists() else None


def append_session_pool_clip(
    project_id: str,
    session_id: str,
    entry: Dict[str, Any],
) -> Dict[str, Any]:
    project_dir = get_project_directory(project_id)
    meta_path = session_pool_metadata_path(project_dir, session_id)
    entries = _load_json_list(meta_path)
    entries.append(entry)
    _save_json_list(meta_path, entries)
    return entry


def mark_session_pool_clip_promoted(
    project_id: str,
    session_id: str,
    clip_id: str,
    library_asset_id: str,
) -> None:
    project_dir = get_project_directory(project_id)
    meta_path = session_pool_metadata_path(project_dir, session_id)
    entries = _load_json_list(meta_path)
    updated: List[Dict[str, Any]] = []
    for row in entries:
        if str(row.get("id") or "") == str(clip_id):
            row = {
                **row,
                "in_library": True,
                "library_asset_id": library_asset_id,
            }
        updated.append(row)
    _save_json_list(meta_path, updated)


def delete_session_pool_clip(
    project_id: str,
    session_id: str,
    clip_id: str,
) -> None:
    """删除单个草稿素材池条目；已收藏到全局素材库时仅删草稿副本，保留素材库文件。"""
    row = get_session_pool_clip(project_id, session_id, clip_id)
    if row is None:
        raise ValueError(f"草稿素材不存在: {clip_id}")

    project_dir = get_project_directory(project_id)
    meta_path = session_pool_metadata_path(project_dir, session_id)
    rel = str(row.get("video_path") or "").strip()
    if rel:
        file_path = project_dir / rel
        if file_path.exists() and file_path.is_file():
            try:
                file_path.unlink()
            except OSError as exc:
                logger.warning("删除 session 素材失败 %s: %s", file_path, exc)

    remaining = [
        item
        for item in _load_json_list(meta_path)
        if str(item.get("id") or "") != str(clip_id)
    ]
    if remaining:
        _save_json_list(meta_path, remaining)
    elif meta_path.exists():
        meta_path.unlink(missing_ok=True)


def delete_session_pool_assets(
    project_id: str,
    session_id: str,
    *,
    skip_library_promoted: bool = True,
) -> int:
    """删除草稿素材池文件；已收藏到全局素材库的条目跳过（全局库已有独立副本）。"""
    project_dir = get_project_directory(project_id)
    pool_dir = session_pool_dir(project_dir, session_id)
    meta_path = session_pool_metadata_path(project_dir, session_id)
    removed = 0
    for row in _load_json_list(meta_path):
        if skip_library_promoted and row.get("in_library"):
            continue
        rel = str(row.get("video_path") or "").strip()
        if not rel:
            continue
        file_path = project_dir / rel
        if file_path.exists() and file_path.is_file():
            try:
                file_path.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("删除 session 素材失败 %s: %s", file_path, exc)
    if pool_dir.exists():
        try:
            shutil.rmtree(pool_dir, ignore_errors=True)
        except OSError as exc:
            logger.warning("清理 session pool 目录失败 %s: %s", pool_dir, exc)
    return removed


def session_pool_metadata_map(project_id: str, session_id: str) -> Dict[str, Dict[str, Any]]:
    mapping: Dict[str, Dict[str, Any]] = {}
    for row in list_session_pool_clips(project_id, session_id):
        clip_id = str(row.get("id") or "")
        if clip_id:
            mapping[clip_id] = row
    return mapping

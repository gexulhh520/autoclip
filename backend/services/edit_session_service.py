"""剪辑工程 EditSession 持久化与构建。"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.core.path_utils import get_project_directory
from backend.services.session_clip_pool_service import (
    POOL_SCOPE,
    POOL_SOURCE,
    POOL_SOURCE_PIPELINE,
    append_session_pool_clip,
    delete_session_pool_assets,
    list_session_pool_clips,
    session_pool_dir,
    session_pool_metadata_map,
    session_pool_metadata_path,
)
from backend.services.material_library_service import (
    is_clip_protected_in_library,
    promote_session_clip_to_library,
)
from backend.pipeline.overlay_pipeline import build_overlay_snapshot
from backend.schemas.edit_session import (
    EditBlock,
    EditBlockMedia,
    EditBlockOverlay,
    EditBlockTrim,
    EditSession,
    EditSessionAudioSettings,
    EditSessionUpdateRequest,
    AudioAssetMeta,
)
from backend.utils.bgm_audio import transcode_bgm_to_m4a
from backend.utils.clip_path_resolver import resolve_clip_video_path
from backend.utils.link_audio_downloader import (
    LinkDownloadError,
    UnsupportedLinkPlatformError,
    detect_link_platform,
    download_link_video,
)
from backend.utils.video_processor import VideoProcessor

logger = logging.getLogger(__name__)

_SESSION_SAVE_LOCKS: dict[str, threading.RLock] = {}
_SESSION_SAVE_LOCKS_GUARD = threading.Lock()
_SESSION_READ_CACHE: dict[str, tuple[float, EditSession]] = {}
_SESSION_READ_CACHE_GUARD = threading.Lock()
_SESSION_READ_CACHE_MAX = 32


def _session_cache_key(path: Path) -> str:
    return str(path.resolve()).lower()


def _invalidate_session_read_cache(path: Path) -> None:
    key = _session_cache_key(path)
    with _SESSION_READ_CACHE_GUARD:
        _SESSION_READ_CACHE.pop(key, None)


def _get_session_save_lock(path: Path) -> threading.RLock:
    key = str(path.resolve()).lower()
    with _SESSION_SAVE_LOCKS_GUARD:
        lock = _SESSION_SAVE_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _SESSION_SAVE_LOCKS[key] = lock
        return lock


def _atomic_write_text(path: Path, content: str, *, retries: int = 8) -> None:
    """原子写文本；Windows 上并发替换 session 文件时需重试与独立 tmp 名。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        last_err: Optional[Exception] = None
        for attempt in range(retries):
            try:
                os.replace(tmp, path)
                return
            except PermissionError as err:
                last_err = err
                time.sleep(0.04 * (attempt + 1))
        if last_err is not None:
            raise last_err
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass



def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _edit_sessions_dir(project_dir: Path) -> Path:
    path = project_dir / "edit_sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session_path(project_dir: Path, session_id: str) -> Path:
    return _edit_sessions_dir(project_dir) / f"{session_id}.json"


def _relative_project_path(project_dir: Path, file_path: Path) -> str:
    try:
        return str(file_path.resolve().relative_to(project_dir.resolve())).replace("\\", "/")
    except ValueError:
        return str(file_path).replace("\\", "/")


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"工程文件损坏（空文件）: {path.name}")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"工程文件损坏（JSON 无效）: {path.name}") from exc


def _load_template_context(project_dir: Path) -> Dict[str, Any]:
    from backend.services.pipeline_steps_service import _load_project_processing_settings

    settings = _load_project_processing_settings(project_dir)
    overlay_snapshot = settings.get("overlay") or build_overlay_snapshot(settings)
    return {
        "template_id": settings.get("template_id"),
        "template_version": settings.get("template_version"),
        "overlay_snapshot": overlay_snapshot,
    }


def _find_source_video(project_dir: Path) -> Optional[Path]:
    raw_dir = project_dir / "raw"
    if not raw_dir.exists():
        return None
    for pattern in ("input.mp4", "sources/*/input.mp4"):
        matches = sorted(raw_dir.glob(pattern))
        for match in matches:
            if match.is_file() and match.stat().st_size > 0:
                return match
    return None


def _srt_timestamp_to_seconds(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        ffmpeg_time = VideoProcessor.convert_srt_time_to_ffmpeg_time(text)
        return VideoProcessor.convert_ffmpeg_time_to_seconds(ffmpeg_time)
    except Exception:
        return None


def _seconds_to_srt_timestamp(total_seconds: float) -> str:
    clamped = max(0.0, total_seconds)
    hours = int(clamped // 3600)
    minutes = int((clamped % 3600) // 60)
    secs = int(clamped % 60)
    millis = int(round((clamped - int(clamped)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _build_block_from_metadata(
    project_dir: Path,
    clip_row: Dict[str, Any],
    *,
    db_clip_id: str,
) -> EditBlock:
    pipeline_id = str(clip_row.get("id") or db_clip_id)
    video_path: Optional[Path] = None
    rel_video = str(clip_row.get("video_path") or "").strip()
    if rel_video:
        candidate = project_dir / rel_video
        if candidate.exists():
            video_path = candidate
    if video_path is None:
        clips_dir = project_dir / "output" / "clips"
        if clips_dir.exists():
            matches = sorted(clips_dir.glob(f"{pipeline_id}_*.mp4"))
            if matches:
                video_path = matches[0]

    source_video = _find_source_video(project_dir)
    is_session_pool = (
        clip_row.get("scope") == POOL_SCOPE
        or clip_row.get("source") in (POOL_SOURCE, POOL_SOURCE_PIPELINE)
        or ("/pool/" in rel_video.replace("\\", "/") and "edit_sessions/" in rel_video)
    )
    source_start_sec = _srt_timestamp_to_seconds(clip_row.get("start_time"))
    source_end_sec = _srt_timestamp_to_seconds(clip_row.get("end_time"))
    duration_sec = 0.0
    trim = EditBlockTrim(in_sec=0.0, out_sec=0.0)

    if video_path and video_path.exists():
        from backend.utils.video_processor import VideoProcessor

        info = VideoProcessor.get_video_info(video_path)
        duration_sec = float(info.get("duration") or 0.0)
        trim = EditBlockTrim(in_sec=0.0, out_sec=duration_sec or 0.0)
        if is_session_pool:
            source_start_sec = 0.0
            source_end_sec = duration_sec
        media = EditBlockMedia(
            type="step6_clip",
            path=_relative_project_path(project_dir, video_path),
            source_video_path=None
            if is_session_pool
            else (
                _relative_project_path(project_dir, source_video) if source_video else None
            ),
            source_start_sec=source_start_sec,
            source_end_sec=source_end_sec,
        )
    else:
        media = EditBlockMedia(type="source_range", path="")
        if source_video:
            media.source_video_path = _relative_project_path(project_dir, source_video)
            media.source_start_sec = source_start_sec
            media.source_end_sec = source_end_sec

    outline = clip_row.get("outline") or ""
    if isinstance(outline, dict):
        outline = str(outline.get("title") or outline.get("outline") or "")

    content = _normalize_content_list(clip_row.get("content"))

    title = (
        str(clip_row.get("generated_title") or "").strip()
        or str(content[0] if content else "").strip()
        or str(outline).strip()
        or f"片段 {pipeline_id}"
    )

    return EditBlock(
        id=str(uuid.uuid4()),
        source_clip_id=db_clip_id,
        title=title,
        media=media,
        trim=trim,
        overlay=EditBlockOverlay(
            outline=str(outline or ""),
            content=content,
            recommend_reason=str(clip_row.get("recommend_reason") or ""),
        ),
        duration_sec=duration_sec,
    )


def _build_session_pool_entry_from_clip_row(
    project_dir: Path,
    session_id: str,
    clip_row: Dict[str, Any],
    *,
    db_clip_id: str,
) -> Dict[str, Any]:
    block = _build_block_from_metadata(project_dir, clip_row, db_clip_id=db_clip_id)
    video_path = str(block.media.path or "").strip()
    if not video_path:
        raise ValueError(f"切片无可用视频: {db_clip_id}")

    outline = clip_row.get("outline") or ""
    if isinstance(outline, dict):
        outline = str(outline.get("title") or outline.get("outline") or "")

    content = _normalize_content_list(clip_row.get("content"))

    return {
        "id": db_clip_id,
        "generated_title": block.title,
        "outline": str(outline or block.title),
        "content": content or block.overlay.content,
        "recommend_reason": str(clip_row.get("recommend_reason") or ""),
        "start_time": clip_row.get("start_time"),
        "end_time": clip_row.get("end_time"),
        "video_path": video_path,
        "source": POOL_SOURCE_PIPELINE,
        "scope": POOL_SCOPE,
        "edit_session_id": session_id,
        "in_library": False,
        "library_asset_id": None,
    }


def _normalize_content_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def _clip_overlay_richness(row: Dict[str, Any]) -> int:
    score = len(_normalize_content_list(row.get("content")))
    if row.get("overlay_copy"):
        score += 10
    return score


def _load_clip_metadata_rows(project_dir: Path, source_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """合并 clips_metadata / step4_titles / 多源目录等全部候选元数据。"""
    from backend.services.data_sync_service import _load_clips_data_from_project_dir

    rows = _load_clips_data_from_project_dir(project_dir) or []
    if source_id:
        sid = str(source_id)
        rows = [row for row in rows if str(row.get("source_id") or "") == sid]
    return rows


def _load_clip_metadata_map(project_dir: Path, source_id: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    mapping: Dict[str, Dict[str, Any]] = {}
    for item in _load_clip_metadata_rows(project_dir, source_id):
        if not isinstance(item, dict):
            continue
        key = str(item.get("id") or "")
        if not key:
            continue
        existing = mapping.get(key)
        if existing is None or _clip_overlay_richness(item) >= _clip_overlay_richness(existing):
            mapping[key] = item
    return mapping


def _clip_time_window(clip: Any) -> tuple[Optional[float], Optional[float]]:
    metadata = getattr(clip, "clip_metadata", None) or {}
    if isinstance(metadata, dict):
        meta_start = _srt_timestamp_to_seconds(metadata.get("start_time"))
        meta_end = _srt_timestamp_to_seconds(metadata.get("end_time"))
        if meta_start is not None and meta_end is not None:
            return meta_start, meta_end

    start_sec = getattr(clip, "start_time", None)
    end_sec = getattr(clip, "end_time", None)
    if start_sec is not None and end_sec is not None:
        try:
            return float(start_sec), float(end_sec)
        except (TypeError, ValueError):
            return None, None
    return None, None


def _find_metadata_row(
    clip: Any,
    metadata_map: Dict[str, Dict[str, Any]],
    metadata_rows: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    metadata = getattr(clip, "clip_metadata", None) or {}
    if not isinstance(metadata, dict):
        metadata = {}

    db_clip_id = str(getattr(clip, "id", "") or "")
    for pipeline_id in (
        _clip_metadata_pipeline_id(metadata, fallback=db_clip_id),
        db_clip_id,
    ):
        if pipeline_id and pipeline_id in metadata_map:
            return metadata_map[pipeline_id]

    clip_start, clip_end = _clip_time_window(clip)
    if clip_start is None or clip_end is None:
        return None

    best_row: Optional[Dict[str, Any]] = None
    best_delta = 999.0
    for row in metadata_rows:
        row_start = _srt_timestamp_to_seconds(row.get("start_time"))
        row_end = _srt_timestamp_to_seconds(row.get("end_time"))
        if row_start is None or row_end is None:
            continue
        delta = abs(row_start - clip_start) + abs(row_end - clip_end)
        if delta < best_delta:
            best_delta = delta
            best_row = row
    if best_row is not None and best_delta <= 3.0:
        return best_row
    return None


def _clip_metadata_pipeline_id(metadata: Dict[str, Any], *, fallback: str = "") -> str:
    """DB 里 pipeline id 可能存于 id 或 original_id（历史同步字段）。"""
    for key in ("id", "original_id"):
        value = metadata.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return fallback


def _resolve_clip_metadata(
    clip: Any,
    metadata_map: Dict[str, Dict[str, Any]],
    metadata_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    metadata = getattr(clip, "clip_metadata", None) or {}
    if not isinstance(metadata, dict):
        metadata = {}

    db_clip_id = str(getattr(clip, "id", "") or "")
    pipeline_id = _clip_metadata_pipeline_id(metadata, fallback=db_clip_id)
    rows = metadata_rows if metadata_rows is not None else list(metadata_map.values())
    file_row = _find_metadata_row(clip, metadata_map, rows)
    db_content = _normalize_content_list(metadata.get("content"))

    if file_row:
        merged = dict(file_row)
        merged.setdefault("generated_title", getattr(clip, "title", None))
        file_content = _normalize_content_list(merged.get("content"))
        merged["content"] = file_content or db_content
        if not merged.get("recommend_reason") and metadata.get("recommend_reason"):
            merged["recommend_reason"] = metadata.get("recommend_reason")
        return merged

    return {
        **metadata,
        "id": pipeline_id or db_clip_id,
        "generated_title": getattr(clip, "title", None) or metadata.get("generated_title"),
        "outline": metadata.get("outline", ""),
        "content": db_content,
        "recommend_reason": metadata.get("recommend_reason", ""),
    }


class EditSessionService:
    def __init__(self, db: Optional[Session] = None) -> None:
        self.db = db

    def list_sessions(self, project_id: str) -> List[EditSession]:
        project_dir = get_project_directory(project_id)
        sessions: List[EditSession] = []
        for path in sorted(_edit_sessions_dir(project_dir).glob("*.json")):
            raw = _load_json(path)
            if isinstance(raw, dict):
                sessions.append(EditSession.model_validate(raw))
        sessions.sort(key=lambda item: item.updated_at, reverse=True)
        return sessions

    def get_session(self, project_id: str, session_id: str) -> EditSession:
        project_dir = get_project_directory(project_id)
        path = _session_path(project_dir, session_id)
        if not path.exists():
            raise FileNotFoundError(session_id)
        cache_key = _session_cache_key(path)
        mtime = path.stat().st_mtime
        with _SESSION_READ_CACHE_GUARD:
            cached = _SESSION_READ_CACHE.get(cache_key)
            if cached is not None and cached[0] == mtime:
                return cached[1]

        raw = _load_json(path)
        if not isinstance(raw, dict):
            raise FileNotFoundError(session_id)
        from backend.schemas.edit_project_v3 import normalize_session

        session = normalize_session(raw)
        with _SESSION_READ_CACHE_GUARD:
            if len(_SESSION_READ_CACHE) >= _SESSION_READ_CACHE_MAX:
                oldest_key = next(iter(_SESSION_READ_CACHE))
                _SESSION_READ_CACHE.pop(oldest_key, None)
            _SESSION_READ_CACHE[cache_key] = (mtime, session)
        return session

    def create_session(
        self,
        project_id: str,
        clip_ids: List[str],
        *,
        name: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> EditSession:
        if not clip_ids:
            raise ValueError("clip_ids 不能为空")

        project_dir = get_project_directory(project_id)
        template_ctx = _load_template_context(project_dir)
        now = _utc_now_iso()
        session = EditSession(
            id=str(uuid.uuid4()),
            project_id=project_id,
            name=name or f"剪辑 {datetime.now().strftime('%m月%d日 %H:%M')}",
            template_id=template_ctx.get("template_id"),
            template_version=template_ctx.get("template_version"),
            overlay_snapshot=template_ctx.get("overlay_snapshot") or {},
            sequence=[],
            created_at=now,
            updated_at=now,
        )
        self._save_session(project_dir, session)
        self.import_clips_to_pool(
            project_id,
            session.id,
            clip_ids,
            source_id=source_id,
        )
        return session

    def import_clips_to_pool(
        self,
        project_id: str,
        session_id: str,
        clip_ids: List[str],
        *,
        source_id: Optional[str] = None,
    ) -> int:
        """将流水线切片写入本草稿 AI 素材池（不入时间线）。"""
        if not clip_ids:
            raise ValueError("clip_ids 不能为空")

        self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        metadata_rows = _load_clip_metadata_rows(project_dir, source_id)
        metadata_map = _load_clip_metadata_map(project_dir, source_id)
        existing_pool = session_pool_metadata_map(project_id, session_id)
        pending_ids = [
            clip_id for clip_id in clip_ids if str(clip_id) not in existing_pool
        ]
        if not pending_ids:
            return 0

        added = 0
        if self.db is not None:
            from backend.models.clip import Clip

            clips = (
                self.db.query(Clip)
                .filter(Clip.project_id == project_id, Clip.id.in_(pending_ids))
                .all()
            )
            clip_by_id = {str(clip.id): clip for clip in clips}
            for clip_id in pending_ids:
                clip = clip_by_id.get(str(clip_id))
                if clip is not None:
                    clip_row = _resolve_clip_metadata(clip, metadata_map, metadata_rows)
                    video_file = resolve_clip_video_path(project_id, clip, project_dir)
                    if video_file and video_file.exists():
                        clip_row = {
                            **clip_row,
                            "video_path": _relative_project_path(project_dir, video_file),
                        }
                    entry = _build_session_pool_entry_from_clip_row(
                        project_dir,
                        session_id,
                        clip_row,
                        db_clip_id=str(clip.id),
                    )
                else:
                    clip_row = metadata_map.get(str(clip_id))
                    if clip_row is None:
                        raise ValueError(f"切片不存在: {clip_id}")
                    entry = _build_session_pool_entry_from_clip_row(
                        project_dir,
                        session_id,
                        clip_row,
                        db_clip_id=str(clip_id),
                    )
                append_session_pool_clip(project_id, session_id, entry)
                added += 1
        else:
            for clip_id in pending_ids:
                clip_row = metadata_map.get(str(clip_id))
                if clip_row is None:
                    raise ValueError(f"切片不存在: {clip_id}")
                entry = _build_session_pool_entry_from_clip_row(
                    project_dir,
                    session_id,
                    clip_row,
                    db_clip_id=str(clip_id),
                )
                append_session_pool_clip(project_id, session_id, entry)
                added += 1
        return added

    def create_blank_session(
        self,
        project_id: str,
        *,
        name: Optional[str] = None,
    ) -> EditSession:
        project_dir = get_project_directory(project_id)
        template_ctx = _load_template_context(project_dir)
        now = _utc_now_iso()
        session = EditSession(
            id=str(uuid.uuid4()),
            project_id=project_id,
            name=name or f"未命名草稿 {datetime.now().strftime('%m月%d日 %H:%M')}",
            template_id=template_ctx.get("template_id"),
            template_version=template_ctx.get("template_version"),
            overlay_snapshot=template_ctx.get("overlay_snapshot") or {},
            sequence=[],
            created_at=now,
            updated_at=now,
        )
        self._save_session(project_dir, session)
        return session

    def append_blocks(
        self,
        project_id: str,
        session_id: str,
        clip_ids: List[str],
        *,
        source_id: Optional[str] = None,
        insert_index: Optional[int] = None,
    ) -> tuple[EditSession, int]:
        if not clip_ids:
            raise ValueError("clip_ids 不能为空")

        session = self.get_session(project_id, session_id)
        existing_ids = {block.source_clip_id for block in session.sequence}
        pending_ids = [clip_id for clip_id in clip_ids if str(clip_id) not in existing_ids]
        if not pending_ids:
            return session, 0

        project_dir = get_project_directory(project_id)
        metadata_rows = _load_clip_metadata_rows(project_dir, source_id)
        metadata_map = _load_clip_metadata_map(project_dir, source_id)
        pool_map = session_pool_metadata_map(project_id, session_id)
        if pool_map:
            metadata_map = {**metadata_map, **pool_map}
            metadata_rows = [*metadata_rows, *pool_map.values()]
        new_blocks: List[EditBlock] = []

        if self.db is not None:
            from backend.models.clip import Clip

            clips = (
                self.db.query(Clip)
                .filter(Clip.project_id == project_id, Clip.id.in_(pending_ids))
                .all()
            )
            clip_by_id = {str(clip.id): clip for clip in clips}
            for clip_id in pending_ids:
                clip = clip_by_id.get(str(clip_id))
                if clip is not None:
                    clip_row = _resolve_clip_metadata(clip, metadata_map, metadata_rows)
                    block = _build_block_from_metadata(
                        project_dir, clip_row, db_clip_id=str(clip.id)
                    )
                    video_file = resolve_clip_video_path(project_id, clip, project_dir)
                    if video_file and video_file.exists():
                        block.media.path = _relative_project_path(project_dir, video_file)
                        block.media.type = "step6_clip"
                else:
                    clip_row = metadata_map.get(str(clip_id))
                    if clip_row is None:
                        raise ValueError(f"切片不存在: {clip_id}")
                    block = _build_block_from_metadata(
                        project_dir, clip_row, db_clip_id=str(clip_id)
                    )
                new_blocks.append(block)
        else:
            for clip_id in pending_ids:
                clip_row = metadata_map.get(str(clip_id))
                if clip_row is None:
                    raise ValueError(f"切片不存在: {clip_id}")
                new_blocks.append(
                    _build_block_from_metadata(project_dir, clip_row, db_clip_id=str(clip_id))
                )

        if not new_blocks:
            return session, 0

        if insert_index is None:
            at = len(session.sequence)
        else:
            at = max(0, min(int(insert_index), len(session.sequence)))
        updated_sequence = [
            *session.sequence[:at],
            *new_blocks,
            *session.sequence[at:],
        ]
        updated = self.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_sequence),
        )
        return updated, len(new_blocks)

    def write_export_to_project(
        self,
        project_id: str,
        session: EditSession,
        output_path: Path,
        *,
        title: Optional[str] = None,
    ) -> str:
        """将导出成片复制到项目 clips 目录并写入 metadata。"""
        import shutil

        project_dir = get_project_directory(project_id)
        clips_dir = project_dir / "output" / "clips"
        clips_dir.mkdir(parents=True, exist_ok=True)

        safe_title = (title or session.name or "剪辑导出").strip()
        for char in '\\/:*?"<>|':
            safe_title = safe_title.replace(char, "_")
        clip_id = f"edit-{session.id[:8]}"
        filename = f"{clip_id}_{safe_title[:48]}.mp4"
        dest = clips_dir / filename
        shutil.copy2(output_path, dest)

        metadata_path = project_dir / "metadata" / "clips_metadata.json"
        entries: List[Dict[str, Any]] = []
        if metadata_path.exists():
            raw = _load_json(metadata_path)
            if isinstance(raw, list):
                entries = [item for item in raw if isinstance(item, dict)]

        entries.append(
            {
                "id": clip_id,
                "outline": safe_title,
                "content": [safe_title],
                "recommend_reason": "剪辑工程导出",
                "generated_title": safe_title,
                "start_time": "00:00:00,000",
                "end_time": "00:00:00,000",
                "video_path": f"output/clips/{filename}",
                "source": "edit_session",
                "edit_session_id": session.id,
            }
        )
        metadata_path.write_text(
            json.dumps(entries, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return str(dest.relative_to(project_dir)).replace("\\", "/")

    def update_session(
        self,
        project_id: str,
        session_id: str,
        payload: EditSessionUpdateRequest,
    ) -> EditSession:
        session = self.get_session(project_id, session_id)
        data = session.model_dump()
        if payload.name is not None:
            data["name"] = payload.name
        if payload.sequence is not None:
            data["sequence"] = [block.model_dump() for block in payload.sequence]
        if payload.overlay_elements is not None:
            data["overlay_elements"] = [item.model_dump() for item in payload.overlay_elements]
        if payload.text_tracks is not None:
            data["text_tracks"] = [item.model_dump() for item in payload.text_tracks]
        if payload.video_tracks is not None:
            data["video_tracks"] = [item.model_dump() for item in payload.video_tracks]
        if payload.audio_assets is not None:
            data["audio_assets"] = [item.model_dump() for item in payload.audio_assets]
        if payload.audio_tracks is not None:
            data["audio_tracks"] = [item.model_dump() for item in payload.audio_tracks]
        if payload.audio_elements is not None:
            data["audio_elements"] = [item.model_dump() for item in payload.audio_elements]
        if payload.bookmarks is not None:
            data["bookmarks"] = [item.model_dump() for item in payload.bookmarks]
        if payload.export_settings is not None:
            data["export_settings"] = payload.export_settings.model_dump()
        if payload.audio_settings is not None:
            data["audio_settings"] = payload.audio_settings.model_dump()
        if payload.schema_version is not None:
            data["schema_version"] = payload.schema_version
        if "voiceover_plan" in payload.model_fields_set:
            if payload.voiceover_plan is None:
                data["voiceover_plan"] = None
            else:
                data["voiceover_plan"] = payload.voiceover_plan.model_dump(mode="json")
        data["updated_at"] = _utc_now_iso()
        updated = EditSession.model_validate(data)
        from backend.schemas.edit_project_v3 import migrate_session_to_v3

        updated.project_v3 = migrate_session_to_v3(updated)
        updated.schema_version = 3
        self._save_session(get_project_directory(project_id), updated)
        return updated

    def delete_session(self, project_id: str, session_id: str) -> None:
        project_dir = get_project_directory(project_id)
        path = _session_path(project_dir, session_id)

        # 清理旧版写入项目 output/clips 的 moment 切片（未收藏到全局素材库的）
        metadata_path = project_dir / "metadata" / "clips_metadata.json"
        if metadata_path.exists():
            raw = _load_json(metadata_path)
            if isinstance(raw, list):
                kept: List[Dict[str, Any]] = []
                for row in raw:
                    if not isinstance(row, dict):
                        continue
                    if str(row.get("edit_session_id") or "") != str(session_id):
                        kept.append(row)
                        continue
                    clip_id = str(row.get("id") or "")
                    if is_clip_protected_in_library(project_id, session_id, clip_id):
                        kept.append(row)
                        continue
                    rel = str(row.get("video_path") or "").strip()
                    if rel:
                        legacy = project_dir / rel
                        if legacy.exists() and legacy.is_file():
                            try:
                                legacy.unlink()
                            except OSError:
                                pass
                metadata_path.write_text(
                    json.dumps(kept, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

        if self.db is not None:
            from backend.models.clip import Clip

            clips = (
                self.db.query(Clip)
                .filter(Clip.project_id == project_id)
                .all()
            )
            for clip in clips:
                meta = getattr(clip, "clip_metadata", None) or {}
                if not isinstance(meta, dict):
                    continue
                if str(meta.get("edit_session_id") or "") != str(session_id):
                    continue
                if is_clip_protected_in_library(
                    project_id, session_id, str(clip.id)
                ):
                    continue
                self.db.delete(clip)
            self.db.commit()

        delete_session_pool_assets(project_id, session_id, skip_library_promoted=True)

        session_dir = project_dir / "edit_sessions" / session_id
        if session_dir.exists():
            shutil.rmtree(session_dir, ignore_errors=True)

        if path.exists():
            path.unlink()

    def regenerate_block_content(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        *,
        mode: str = "both",
    ) -> EditSession:
        session = self.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == block_id), None)
        if block is None:
            raise ValueError("片段不存在")
        if block.media.source_start_sec is None or block.media.source_end_sec is None:
            raise ValueError("片段缺少原片时间码，无法重写文案")

        from backend.services.pipeline_steps_service import regenerate_timeline_item_content

        start_time = _seconds_to_srt_timestamp(float(block.media.source_start_sec))
        end_time = _seconds_to_srt_timestamp(float(block.media.source_end_sec))
        result = regenerate_timeline_item_content(
            project_id,
            start_time,
            end_time,
            mode=mode,
            current_outline=block.overlay.outline,
            current_content=block.overlay.content,
        )
        sequence: List[EditBlock] = []
        for item in session.sequence:
            if item.id == block_id:
                updated = item.model_copy(deep=True)
                updated.overlay.outline = result["outline"]
                updated.overlay.content = result["content"]
                sequence.append(updated)
            else:
                sequence.append(item)
        return self.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=sequence),
        )

    _IMPORT_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}
    _IMPORT_COPY_CHUNK_BYTES = 8 * 1024 * 1024

    @classmethod
    def _normalize_import_suffix(cls, suffix: str) -> str:
        normalized = (suffix or "").lower()
        return normalized if normalized in cls._IMPORT_VIDEO_SUFFIXES else ".mp4"

    @classmethod
    def _prepare_import_video_source(cls, source: Path, dest: Path) -> tuple[Path, str]:
        """尽量硬链接/符号链接或路径引用，避免大文件整盘复制。"""
        source = source.resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            dest.unlink()

        if source == dest.resolve():
            return source, "reference"

        try:
            os.link(source, dest)
            return dest.resolve(), "hardlink"
        except OSError as exc:
            logger.debug("导入硬链接失败，尝试符号链接: %s", exc)

        try:
            os.symlink(source, dest)
            return dest.resolve(), "symlink"
        except OSError as exc:
            logger.debug("导入符号链接失败，改用路径引用: %s", exc)

        return source, "reference"

    @classmethod
    def _copy_import_video_source(cls, source: Path, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with source.open("rb") as src, dest.open("wb") as dst:
            shutil.copyfileobj(src, dst, length=cls._IMPORT_COPY_CHUNK_BYTES)

    def _finalize_imported_video(
        self,
        project_id: str,
        session_id: str,
        session: EditSession,
        project_dir: Path,
        media_file: Path,
        *,
        import_id: str,
        title: str,
        insert_index: Optional[int] = None,
        defer_duration_probe: bool = False,
    ) -> tuple[EditSession, EditBlock]:
        if defer_duration_probe:
            duration_sec = 0.0
        else:
            duration_sec = VideoProcessor.probe_video_duration_sec(media_file)
            if duration_sec <= 0:
                logger.warning("导入视频时长探测失败，使用占位时长: %s", media_file)
                duration_sec = 0.1

        safe_title = (title or "导入视频").strip()[:64] or "导入视频"
        block = EditBlock(
            id=str(uuid.uuid4()),
            source_clip_id=import_id,
            title=safe_title,
            media=EditBlockMedia(
                type="imported_clip",
                path=_relative_project_path(project_dir, media_file.resolve()),
            ),
            trim=EditBlockTrim(in_sec=0.0, out_sec=duration_sec),
            overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
            duration_sec=duration_sec,
            playback_rate=1.0,
        )

        if insert_index is None:
            at = len(session.sequence)
        else:
            at = max(0, min(int(insert_index), len(session.sequence)))
        updated_sequence = [*session.sequence[:at], block, *session.sequence[at:]]

        updated = self.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_sequence),
        )
        saved_block = next((item for item in updated.sequence if item.id == block.id), block)
        return updated, saved_block

    def _update_imported_block_fields(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        *,
        duration_sec: Optional[float] = None,
        media_path: Optional[str] = None,
    ) -> None:
        session = self.get_session(project_id, session_id)
        updated_blocks: List[EditBlock] = []
        found = False
        for item in session.sequence:
            if item.id != block_id:
                updated_blocks.append(item)
                continue
            found = True
            data = item.model_dump()
            if duration_sec is not None and duration_sec > 0:
                data["duration_sec"] = duration_sec
                trim = dict(data.get("trim") or {})
                if float(trim.get("out_sec") or 0) <= 0.1:
                    trim["out_sec"] = duration_sec
                if float(trim.get("in_sec") or 0) < 0:
                    trim["in_sec"] = 0.0
                data["trim"] = trim
            if media_path:
                media = dict(data.get("media") or {})
                media["path"] = media_path
                data["media"] = media
            updated_blocks.append(EditBlock.model_validate(data))
        if not found:
            return
        self.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_blocks),
        )

    def schedule_imported_media_postprocess(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        media_file: Path,
    ) -> None:
        """后台探测时长并生成 faststart 副本，不阻塞导入 API。"""

        def _run() -> None:
            try:
                resolved = media_file.resolve()
                duration_sec = VideoProcessor.probe_video_duration_sec(resolved)
                if duration_sec > 0:
                    self._update_imported_block_fields(
                        project_id,
                        session_id,
                        block_id,
                        duration_sec=duration_sec,
                    )

                streamable = VideoProcessor.remux_faststart(resolved)
                if streamable is None:
                    return

                project_dir = get_project_directory(project_id)
                rel = _relative_project_path(project_dir, streamable)
                self._update_imported_block_fields(
                    project_id,
                    session_id,
                    block_id,
                    media_path=rel,
                )
            except Exception:
                logger.exception(
                    "导入媒体后处理失败 project=%s session=%s block=%s",
                    project_id,
                    session_id,
                    block_id,
                )

        threading.Thread(
            target=_run,
            name=f"import-postprocess-{block_id[:8]}",
            daemon=True,
        ).start()

    def probe_imported_block_duration(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
    ) -> float:
        session = self.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == block_id), None)
        if block is None:
            raise ValueError("片段不存在")
        if block.duration_sec > 0.1:
            return float(block.duration_sec)

        project_dir = get_project_directory(project_id)
        from backend.pipeline.edit_renderer import _resolve_input_video

        video_path = _resolve_input_video(project_dir, block)
        duration_sec = VideoProcessor.probe_video_duration_sec(video_path)
        if duration_sec > 0:
            self._update_imported_block_fields(
                project_id,
                session_id,
                block_id,
                duration_sec=duration_sec,
            )
        return duration_sec

    def import_media_from_path(
        self,
        project_id: str,
        session_id: str,
        source_path: str,
        *,
        insert_index: Optional[int] = None,
        title: Optional[str] = None,
    ) -> tuple[EditSession, EditBlock, str]:
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
        if suffix not in self._IMPORT_VIDEO_SUFFIXES:
            raise ValueError(f"不支持的视频格式: {suffix or '(无扩展名)'}")

        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        media_dir = _edit_sessions_dir(project_dir) / session_id / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        import_id = f"import-{uuid.uuid4().hex[:12]}"
        dest = media_dir / f"{import_id}{suffix}"
        media_file, link_method = self._prepare_import_video_source(source, dest)
        logger.info(
            "路径导入链接完成 method=%s source=%s",
            link_method,
            source.name,
        )

        session, block = self._finalize_imported_video(
            project_id,
            session_id,
            session,
            project_dir,
            media_file,
            import_id=import_id,
            title=(title or source.stem)[:255],
            insert_index=insert_index,
            defer_duration_probe=True,
        )
        self.schedule_imported_media_postprocess(
            project_id,
            session_id,
            block.id,
            media_file,
        )
        logger.info(
            "路径导入完成 block_id=%s method=%s duration_pending=%s",
            block.id,
            link_method,
            block.duration_sec <= 0,
        )
        return session, block, link_method

    def import_media_file(
        self,
        project_id: str,
        session_id: str,
        file_name: str,
        content: bytes,
        *,
        insert_index: Optional[int] = None,
    ) -> tuple[EditSession, EditBlock]:
        if not content:
            raise ValueError("视频文件为空")

        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        media_dir = _edit_sessions_dir(project_dir) / session_id / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        suffix = self._normalize_import_suffix(Path(file_name).suffix)
        import_id = f"import-{uuid.uuid4().hex[:12]}"
        dest = media_dir / f"{import_id}{suffix}"
        dest.write_bytes(content)

        title = Path(file_name).stem.strip() or "导入视频"
        session, block = self._finalize_imported_video(
            project_id,
            session_id,
            session,
            project_dir,
            dest,
            import_id=import_id,
            title=title,
            insert_index=insert_index,
            defer_duration_probe=True,
        )
        self.schedule_imported_media_postprocess(
            project_id,
            session_id,
            block.id,
            dest,
        )
        return session, block

    def import_media_file_to_path(
        self,
        project_id: str,
        session_id: str,
        file_name: str,
        dest: Path,
        *,
        insert_index: Optional[int] = None,
    ) -> tuple[EditSession, EditBlock]:
        """上传流已写入 dest 后，完成导入 block 创建。"""
        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        import_id = f"import-{uuid.uuid4().hex[:12]}"
        title = Path(file_name).stem.strip() or "导入视频"
        session, block = self._finalize_imported_video(
            project_id,
            session_id,
            session,
            project_dir,
            dest,
            import_id=import_id,
            title=title,
            insert_index=insert_index,
            defer_duration_probe=True,
        )
        self.schedule_imported_media_postprocess(
            project_id,
            session_id,
            block.id,
            dest,
        )
        return session, block

    def _import_bgm_from_local_file(
        self,
        project_id: str,
        session_id: str,
        session: EditSession,
        source_path: Path,
        display_name: str,
        *,
        category: str = "bgm",
    ) -> EditSession:
        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        asset_id = str(uuid.uuid4())
        output_path = session_dir / f"asset_{asset_id}.m4a"
        for old in session_dir.glob(f"asset_{asset_id}*"):
            try:
                old.unlink()
            except OSError:
                logger.warning("无法删除旧音频资源: %s", old)

        suffix = source_path.suffix.lower() or ".mp3"
        if transcode_bgm_to_m4a(source_path, output_path):
            stored_path = output_path
        else:
            logger.warning("BGM 转码失败，保留原文件: %s", source_path.name)
            fallback = session_dir / f"asset_{asset_id}{suffix}"
            if fallback.exists():
                fallback.unlink()
            if source_path.resolve() != fallback.resolve():
                source_path.replace(fallback)
            stored_path = fallback

        duration_sec: Optional[float] = None
        try:
            info = VideoProcessor.get_video_info(stored_path)
            duration_sec = float(info.get("duration") or 0) or None
        except Exception:
            duration_sec = None

        rel = _relative_project_path(project_dir, stored_path)
        return self.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                audio_assets=[
                    *(session.audio_assets or []),
                    AudioAssetMeta(
                        id=asset_id,
                        name=display_name,
                        path=rel,
                        duration_sec=duration_sec,
                        category=category if category in ("sfx", "bgm") else "bgm",
                    ),
                ]
            ),
        )

    def _save_audio_upload(
        self,
        project_id: str,
        session_id: str,
        file_name: str,
        content: bytes,
        *,
        category: str,
        upload_prefix: str,
    ) -> EditSession:
        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(file_name).suffix.lower() or ".mp3"
        upload_path = session_dir / f"{upload_prefix}{suffix}"
        upload_path.write_bytes(content)

        try:
            return self._import_bgm_from_local_file(
                project_id,
                session_id,
                session,
                upload_path,
                Path(file_name).name or upload_path.name,
                category=category,
            )
        finally:
            if upload_path.exists() and upload_path.name.startswith(upload_prefix):
                try:
                    upload_path.unlink()
                except OSError:
                    pass

    def save_bgm_file(
        self,
        project_id: str,
        session_id: str,
        file_name: str,
        content: bytes,
    ) -> EditSession:
        return self._save_audio_upload(
            project_id,
            session_id,
            file_name,
            content,
            category="bgm",
            upload_prefix="bgm_upload",
        )

    def save_sfx_file(
        self,
        project_id: str,
        session_id: str,
        file_name: str,
        content: bytes,
    ) -> EditSession:
        return self._save_audio_upload(
            project_id,
            session_id,
            file_name,
            content,
            category="sfx",
            upload_prefix="sfx_upload",
        )

    @staticmethod
    def _normalize_tts_text(text: str) -> str:
        snippet = text.strip().replace("\n", " ")
        if not snippet:
            raise ValueError("文本为空")
        return snippet

    async def preview_speech(
        self,
        project_id: str,
        session_id: str,
        text: str,
        *,
        voice: Optional[str] = None,
        rate: str = "+0%",
    ) -> tuple[bytes, str]:
        import tempfile

        from backend.utils.edge_tts_service import synthesize_to_file

        self.get_session(project_id, session_id)
        snippet = self._normalize_tts_text(text)

        tmp_path = Path(tempfile.mktemp(suffix=".mp3", prefix="tts_preview_"))
        try:
            await synthesize_to_file(
                snippet,
                tmp_path,
                voice=voice,
                rate=rate,
            )
            return tmp_path.read_bytes(), "audio/mpeg"
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    logger.warning("无法删除临时预读文件: %s", tmp_path)

    async def synthesize_speech(
        self,
        project_id: str,
        session_id: str,
        text: str,
        *,
        voice: Optional[str] = None,
        rate: str = "+0%",
        overlay_id: Optional[str] = None,
    ) -> tuple[EditSession, str, float, str]:
        from backend.utils.edge_tts_service import synthesize_to_file

        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        snippet = self._normalize_tts_text(text)

        tmp_path = session_dir / f"tts_{uuid.uuid4().hex}.mp3"
        try:
            selected_voice = await synthesize_to_file(
                snippet,
                tmp_path,
                voice=voice,
                rate=rate,
            )
            label = snippet[:24] + ("…" if len(snippet) > 24 else "")
            display_name = f"朗读-{label}.mp3"
            updated = self._import_bgm_from_local_file(
                project_id,
                session_id,
                session,
                tmp_path,
                display_name,
                category="sfx",
            )
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    logger.warning("无法删除临时 TTS 文件: %s", tmp_path)

        new_asset = updated.audio_assets[-1] if updated.audio_assets else None
        if not new_asset:
            raise RuntimeError("TTS 音频资源写入失败")

        duration_sec = float(new_asset.duration_sec or 0.0)
        if duration_sec <= 0:
            try:
                info = VideoProcessor.get_video_info(
                    project_dir / new_asset.path
                )
                duration_sec = float(info.get("duration") or 0) or 1.0
            except Exception:
                duration_sec = 1.0

        return updated, new_asset.id, duration_sec, selected_voice

    def import_bgm_from_url(
        self,
        project_id: str,
        session_id: str,
        url: str,
        platform: Optional[str] = None,
    ) -> EditSession:
        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        import_dir = session_dir / f"url_import_{uuid.uuid4().hex[:8]}"
        import_dir.mkdir(parents=True, exist_ok=True)

        resolved_platform = platform or detect_link_platform(url)
        if not resolved_platform:
            raise UnsupportedLinkPlatformError("暂不支持该链接")

        video_path: Optional[Path] = None
        try:
            video_path, title = download_link_video(url, import_dir, resolved_platform)
            display_name = f"{title}.m4a" if title else "链接音频.m4a"
            return self._import_bgm_from_local_file(
                project_id,
                session_id,
                session,
                video_path,
                display_name,
            )
        except (UnsupportedLinkPlatformError, LinkDownloadError, ValueError):
            raise
        except Exception as exc:
            logger.exception("从链接导入 BGM 失败: %s", url)
            raise LinkDownloadError(str(exc)) from exc
        finally:
            if video_path and video_path.exists():
                try:
                    video_path.unlink()
                except OSError:
                    logger.warning("无法删除临时视频: %s", video_path)
            try:
                if import_dir.exists():
                    import_dir.rmdir()
            except OSError:
                for leftover in import_dir.glob("*"):
                    try:
                        leftover.unlink()
                    except OSError:
                        pass
                try:
                    import_dir.rmdir()
                except OSError:
                    logger.warning("无法清理临时目录: %s", import_dir)

    def resolve_audio_asset_path(
        self,
        project_id: str,
        session_id: str,
        asset_id: str,
    ) -> Path:
        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        for asset in session.audio_assets:
            if asset.id == asset_id:
                path = project_dir / asset.path
                if path.exists():
                    return path
                raise FileNotFoundError(f"音频资源不存在: {asset.path}")
        legacy = session.audio_settings.bgm_path
        if legacy and asset_id.startswith("legacy-"):
            path = project_dir / legacy
            if path.exists():
                return path
        raise FileNotFoundError(f"未找到音频资源: {asset_id}")

    def export_moment_matches_to_clip_pool(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        matches: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """将检索匹配时间段 ffmpeg 切出并写入本草稿素材池（仅 clips.json + pool 目录，不入项目切片库）。"""
        if not matches:
            return {"block_id": block_id, "created_count": 0, "clip_ids": [], "note": "无匹配片段"}

        session = self.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == block_id), None)
        if block is None:
            raise ValueError(f"片段不存在: {block_id}")

        project_dir = get_project_directory(project_id)
        media_rel = str(block.media.path or "").strip()
        if not media_rel:
            raise ValueError("源片段无媒体文件，无法导出到素材池")
        source_video = project_dir / media_rel
        if not source_video.exists():
            raise ValueError(f"媒体文件不存在: {media_rel}")

        from backend.utils.video_processor import VideoProcessor

        clips_dir = session_pool_dir(project_dir, session_id)
        clips_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = session_pool_metadata_path(project_dir, session_id)
        entries: List[Dict[str, Any]] = []
        if metadata_path.exists():
            raw = _load_json(metadata_path)
            if isinstance(raw, list):
                entries = [item for item in raw if isinstance(item, dict)]

        sorted_matches = sorted(
            matches,
            key=lambda item: float(item.get("trim_in_sec") or 0),
        )
        created_ids: List[str] = []

        for index, match in enumerate(sorted_matches):
            trim_in = float(match.get("trim_in_sec") or 0)
            trim_out = float(match.get("trim_out_sec") or trim_in)
            if trim_out <= trim_in + 0.1:
                continue

            preview = str(match.get("text_preview") or match.get("match_reason") or "").strip()
            title = preview[:48] or f"检索片段 {index + 1}"
            safe_title = title
            for char in '\\/:*?"<>|':
                safe_title = safe_title.replace(char, "_")
            safe_title = safe_title.replace("\n", " ").strip()[:32] or f"clip_{index + 1}"

            clip_id = f"moment-{uuid.uuid4().hex[:12]}"
            filename = f"{clip_id}_{safe_title}.mp4"
            dest = clips_dir / filename
            segment_duration = trim_out - trim_in
            start_srt = _seconds_to_srt_timestamp(0)
            end_srt = _seconds_to_srt_timestamp(segment_duration)
            extract_in = _seconds_to_srt_timestamp(trim_in)
            extract_out = _seconds_to_srt_timestamp(trim_out)

            if not VideoProcessor.extract_clip(source_video, dest, extract_in, extract_out):
                logger.warning("moment 导出切片失败: %s", dest)
                continue

            rel_video = f"edit_sessions/{session_id}/pool/{filename}"
            metadata_entry: Dict[str, Any] = {
                "id": clip_id,
                "generated_title": title,
                "outline": title,
                "content": [preview] if preview else [title],
                "recommend_reason": str(match.get("match_reason") or "Agent 检索导出"),
                "start_time": start_srt,
                "end_time": end_srt,
                "video_path": rel_video,
                "source": POOL_SOURCE,
                "scope": POOL_SCOPE,
                "edit_session_id": session_id,
                "source_block_id": block_id,
                "match_score": match.get("match_score"),
                "in_library": False,
                "library_asset_id": None,
            }
            entries.append(metadata_entry)
            created_ids.append(clip_id)

        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(
            json.dumps(entries, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        note = f"已导出 {len(created_ids)} 个切片到本草稿素材池"
        if len(created_ids) < len(sorted_matches):
            note += "（部分片段导出失败或时长过短已跳过）"
        return {
            "block_id": block_id,
            "created_count": len(created_ids),
            "clip_ids": created_ids,
            "note": note,
        }

    @staticmethod
    def _save_session(project_dir: Path, session: EditSession) -> None:
        path = _session_path(project_dir, session.id)
        payload = json.dumps(session.model_dump(), ensure_ascii=False, separators=(",", ":"))
        lock = _get_session_save_lock(path)
        with lock:
            _invalidate_session_read_cache(path)
            _atomic_write_text(path, payload)

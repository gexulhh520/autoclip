"""剪辑工程 EditSession 持久化与构建。"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.core.path_utils import get_project_directory
from backend.pipeline.overlay_pipeline import build_overlay_snapshot
from backend.schemas.edit_session import (
    EditBlock,
    EditBlockMedia,
    EditBlockOverlay,
    EditBlockTrim,
    EditSession,
    EditSessionAudioSettings,
    EditSessionUpdateRequest,
)
from backend.utils.clip_path_resolver import resolve_clip_video_path
from backend.utils.video_processor import VideoProcessor

logger = logging.getLogger(__name__)


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
    return json.loads(path.read_text(encoding="utf-8"))


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
    clips_dir = project_dir / "output" / "clips"
    video_path: Optional[Path] = None
    if clips_dir.exists():
        matches = sorted(clips_dir.glob(f"{pipeline_id}_*.mp4"))
        if matches:
            video_path = matches[0]

    source_video = _find_source_video(project_dir)
    source_start_sec = _srt_timestamp_to_seconds(clip_row.get("start_time"))
    source_end_sec = _srt_timestamp_to_seconds(clip_row.get("end_time"))
    duration_sec = 0.0
    trim = EditBlockTrim(in_sec=0.0, out_sec=0.0)

    if video_path and video_path.exists():
        from backend.utils.video_processor import VideoProcessor

        info = VideoProcessor.get_video_info(video_path)
        duration_sec = float(info.get("duration") or 0.0)
        trim = EditBlockTrim(in_sec=0.0, out_sec=duration_sec or 0.0)
        media = EditBlockMedia(
            type="step6_clip",
            path=_relative_project_path(project_dir, video_path),
            source_video_path=_relative_project_path(project_dir, source_video)
            if source_video
            else None,
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

    content = clip_row.get("content") or []
    if isinstance(content, str):
        content = [content]

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
            content=[str(item).strip() for item in content if str(item).strip()],
            recommend_reason=str(clip_row.get("recommend_reason") or ""),
        ),
        duration_sec=duration_sec,
    )


def _load_clip_metadata_map(project_dir: Path, source_id: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    if source_id:
        metadata_path = project_dir / "metadata" / "sources" / source_id / "clips_metadata.json"
    else:
        metadata_path = project_dir / "metadata" / "clips_metadata.json"
    raw = _load_json(metadata_path)
    if not isinstance(raw, list):
        return {}
    mapping: Dict[str, Dict[str, Any]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = str(item.get("id") or "")
        if key:
            mapping[key] = item
    return mapping


def _resolve_clip_metadata(
    clip: Any,
    metadata_map: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    metadata = getattr(clip, "clip_metadata", None) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    pipeline_id = metadata.get("id")
    if pipeline_id is not None and str(pipeline_id) in metadata_map:
        merged = dict(metadata_map[str(pipeline_id)])
        merged.setdefault("generated_title", getattr(clip, "title", None))
        return merged
    return {
        **metadata,
        "id": pipeline_id or getattr(clip, "id", ""),
        "generated_title": getattr(clip, "title", None) or metadata.get("generated_title"),
        "outline": metadata.get("outline", ""),
        "content": metadata.get("content", []),
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
        raw = _load_json(path)
        if not isinstance(raw, dict):
            raise FileNotFoundError(session_id)
        return EditSession.model_validate(raw)

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
        metadata_map = _load_clip_metadata_map(project_dir, source_id)
        template_ctx = _load_template_context(project_dir)

        blocks: List[EditBlock] = []
        if self.db is not None:
            from backend.models.clip import Clip

            clips = (
                self.db.query(Clip)
                .filter(Clip.project_id == project_id, Clip.id.in_(clip_ids))
                .all()
            )
            clip_by_id = {str(clip.id): clip for clip in clips}
            for clip_id in clip_ids:
                clip = clip_by_id.get(str(clip_id))
                if clip is None:
                    raise ValueError(f"切片不存在: {clip_id}")
                clip_row = _resolve_clip_metadata(clip, metadata_map)
                block = _build_block_from_metadata(project_dir, clip_row, db_clip_id=str(clip.id))
                video_file = resolve_clip_video_path(project_id, clip, project_dir)
                if video_file and video_file.exists():
                    block.media.path = _relative_project_path(project_dir, video_file)
                    block.media.type = "step6_clip"
                blocks.append(block)
        else:
            for clip_id in clip_ids:
                clip_row = metadata_map.get(str(clip_id))
                if clip_row is None:
                    raise ValueError(f"切片不存在: {clip_id}")
                blocks.append(
                    _build_block_from_metadata(project_dir, clip_row, db_clip_id=str(clip_id))
                )

        if not blocks:
            raise ValueError("未能构建任何剪辑片段")

        now = _utc_now_iso()
        session = EditSession(
            id=str(uuid.uuid4()),
            project_id=project_id,
            name=name or f"剪辑 {datetime.now().strftime('%m月%d日 %H:%M')}",
            template_id=template_ctx.get("template_id"),
            template_version=template_ctx.get("template_version"),
            overlay_snapshot=template_ctx.get("overlay_snapshot") or {},
            sequence=blocks,
            created_at=now,
            updated_at=now,
        )
        self._save_session(project_dir, session)
        return session

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
    ) -> tuple[EditSession, int]:
        if not clip_ids:
            raise ValueError("clip_ids 不能为空")

        session = self.get_session(project_id, session_id)
        existing_ids = {block.source_clip_id for block in session.sequence}
        pending_ids = [clip_id for clip_id in clip_ids if str(clip_id) not in existing_ids]
        if not pending_ids:
            return session, 0

        project_dir = get_project_directory(project_id)
        metadata_map = _load_clip_metadata_map(project_dir, source_id)
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
                if clip is None:
                    raise ValueError(f"切片不存在: {clip_id}")
                clip_row = _resolve_clip_metadata(clip, metadata_map)
                block = _build_block_from_metadata(project_dir, clip_row, db_clip_id=str(clip.id))
                video_file = resolve_clip_video_path(project_id, clip, project_dir)
                if video_file and video_file.exists():
                    block.media.path = _relative_project_path(project_dir, video_file)
                    block.media.type = "step6_clip"
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

        updated_sequence = [*session.sequence, *new_blocks]
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
        if payload.export_settings is not None:
            data["export_settings"] = payload.export_settings.model_dump()
        if payload.audio_settings is not None:
            data["audio_settings"] = payload.audio_settings.model_dump()
        data["updated_at"] = _utc_now_iso()
        updated = EditSession.model_validate(data)
        self._save_session(get_project_directory(project_id), updated)
        return updated

    def delete_session(self, project_id: str, session_id: str) -> None:
        project_dir = get_project_directory(project_id)
        path = _session_path(project_dir, session_id)
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

    def save_bgm_file(
        self,
        project_id: str,
        session_id: str,
        file_name: str,
        content: bytes,
    ) -> EditSession:
        session = self.get_session(project_id, session_id)
        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(file_name).suffix.lower() or ".mp3"
        bgm_path = session_dir / f"bgm{suffix}"
        bgm_path.write_bytes(content)
        rel = _relative_project_path(project_dir, bgm_path)
        audio_settings = session.audio_settings.model_dump()
        audio_settings["bgm_path"] = rel
        return self.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                audio_settings=EditSessionAudioSettings.model_validate(audio_settings)
            ),
        )

    @staticmethod
    def _save_session(project_dir: Path, session: EditSession) -> None:
        path = _session_path(project_dir, session.id)
        path.write_text(
            json.dumps(session.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

"""多源视频项目 — processing_config 与路径辅助。"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.core.path_utils import (
    get_project_source_raw_directory,
    resolve_source_srt_path,
    resolve_source_video_path,
)
from backend.schemas.project_source import (
    MultiSourceConfig,
    MultiSourceProjectSummary,
    ProjectSourceRecord,
    ProjectSourceStatus,
    ProjectSourceSummary,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def new_source_id() -> str:
    return f"src_{uuid.uuid4().hex[:12]}"


def get_multi_source_config(processing_config: Optional[Dict[str, Any]]) -> MultiSourceConfig:
    raw = (processing_config or {}).get("multi_source") or {}
    if not raw:
        return MultiSourceConfig(enabled=False, sources=[])
    return MultiSourceConfig.model_validate(raw)


def is_multi_source_project(processing_config: Optional[Dict[str, Any]]) -> bool:
    cfg = get_multi_source_config(processing_config)
    return cfg.enabled and len(cfg.sources) > 0


def attach_multi_source_to_config(
    processing_config: Dict[str, Any],
    sources: List[ProjectSourceRecord],
) -> Dict[str, Any]:
    config = copy.deepcopy(processing_config)
    config["multi_source"] = MultiSourceConfig(
        enabled=True,
        current_source_index=None,
        sources=sources,
    ).model_dump(mode="json")
    return config


def build_source_records(filenames: List[str]) -> List[ProjectSourceRecord]:
    records: List[ProjectSourceRecord] = []
    for index, name in enumerate(filenames):
        source_id = new_source_id()
        records.append(
            ProjectSourceRecord(
                id=source_id,
                index=index,
                original_filename=name,
                status=ProjectSourceStatus.PENDING,
            )
        )
    return records


def assign_source_paths(project_id: str, source: ProjectSourceRecord) -> ProjectSourceRecord:
    video_path = resolve_source_video_path(project_id, source.id)
    srt_path = resolve_source_srt_path(project_id, source.id)
    updated = source.model_copy(
        update={
            "video_path": str(video_path),
            "subtitle_path": str(srt_path),
        }
    )
    return updated


def get_sources_ordered(processing_config: Optional[Dict[str, Any]]) -> List[ProjectSourceRecord]:
    cfg = get_multi_source_config(processing_config)
    return sorted(cfg.sources, key=lambda s: s.index)


def get_pending_sources(processing_config: Optional[Dict[str, Any]]) -> List[ProjectSourceRecord]:
    return [
        s
        for s in get_sources_ordered(processing_config)
        if s.status in (ProjectSourceStatus.PENDING, ProjectSourceStatus.FAILED)
    ]


def find_source(
    processing_config: Optional[Dict[str, Any]], source_id: str
) -> Optional[ProjectSourceRecord]:
    for source in get_sources_ordered(processing_config):
        if source.id == source_id:
            return source
    return None


def update_source_in_config(
    processing_config: Dict[str, Any],
    source_id: str,
    **updates: Any,
) -> Dict[str, Any]:
    config = copy.deepcopy(processing_config)
    cfg = get_multi_source_config(config)
    if not cfg.enabled:
        return config
    new_sources: List[ProjectSourceRecord] = []
    for source in cfg.sources:
        if source.id == source_id:
            new_sources.append(source.model_copy(update=updates))
        else:
            new_sources.append(source)
    config["multi_source"] = cfg.model_copy(update={"sources": new_sources}).model_dump(mode="json")
    return config


def mark_source_processing(processing_config: Dict[str, Any], source_id: str) -> Dict[str, Any]:
    source = find_source(processing_config, source_id)
    if not source:
        return processing_config
    return update_source_in_config(
        processing_config,
        source_id,
        status=ProjectSourceStatus.PROCESSING,
        started_at=_utc_now_iso(),
        error_message=None,
        current_step="download",
    )


def mark_source_completed(
    processing_config: Dict[str, Any],
    source_id: str,
    *,
    clips_count: int = 0,
) -> Dict[str, Any]:
    return update_source_in_config(
        processing_config,
        source_id,
        status=ProjectSourceStatus.COMPLETED,
        completed_at=_utc_now_iso(),
        clips_count=clips_count,
        current_step=None,
        error_message=None,
    )


def mark_source_failed(
    processing_config: Dict[str, Any],
    source_id: str,
    error_message: str,
) -> Dict[str, Any]:
    return update_source_in_config(
        processing_config,
        source_id,
        status=ProjectSourceStatus.FAILED,
        error_message=error_message,
        current_step=None,
    )


def set_current_source_index(processing_config: Dict[str, Any], index: Optional[int]) -> Dict[str, Any]:
    config = copy.deepcopy(processing_config)
    cfg = get_multi_source_config(config)
    if not cfg.enabled:
        return config
    config["multi_source"] = cfg.model_copy(update={"current_source_index": index}).model_dump(
        mode="json"
    )
    return config


def aggregate_project_status(sources: List[ProjectSourceRecord]) -> str:
    if not sources:
        return "pending"
    if any(s.status == ProjectSourceStatus.PROCESSING for s in sources):
        return "processing"
    if any(s.status == ProjectSourceStatus.FAILED for s in sources):
        return "failed"
    if all(s.status == ProjectSourceStatus.COMPLETED for s in sources):
        return "completed"
    if any(s.status == ProjectSourceStatus.COMPLETED for s in sources):
        return "processing"
    return "pending"


def summarize_multi_source(
    processing_config: Optional[Dict[str, Any]],
) -> MultiSourceProjectSummary:
    cfg = get_multi_source_config(processing_config)
    sources = get_sources_ordered(processing_config)
    active = next((s for s in sources if s.status == ProjectSourceStatus.PROCESSING), None)
    completed = sum(1 for s in sources if s.status == ProjectSourceStatus.COMPLETED)
    return MultiSourceProjectSummary(
        enabled=cfg.enabled and len(sources) > 0,
        total_sources=len(sources),
        completed_sources=completed,
        active_source_id=active.id if active else None,
        sources=[
            ProjectSourceSummary(
                id=s.id,
                index=s.index,
                original_filename=s.original_filename,
                status=s.status,
                clips_count=s.clips_count,
                current_step=s.current_step,
                error_message=s.error_message,
            )
            for s in sources
        ],
    )


def source_media_paths(project_id: str, source: ProjectSourceRecord) -> Tuple[str, Optional[str]]:
    video = str(resolve_source_video_path(project_id, source.id))
    srt = resolve_source_srt_path(project_id, source.id)
    srt_path = str(srt) if srt.exists() else None
    return video, srt_path


def ensure_source_raw_dir(project_id: str, source_id: str):
    get_project_source_raw_directory(project_id, source_id)

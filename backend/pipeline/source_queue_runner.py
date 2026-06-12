"""按上传顺序串行处理多源视频项目。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Dict, Optional

from backend.core.database import SessionLocal
from backend.models.project import Project, ProjectStatus
from backend.services.project_source_service import (
    aggregate_project_status,
    get_pending_sources,
    get_sources_ordered,
    mark_source_completed,
    mark_source_failed,
    mark_source_processing,
    set_current_source_index,
    source_media_paths,
)
from backend.services.simple_pipeline_adapter import create_simple_pipeline_adapter

logger = logging.getLogger(__name__)


def _count_source_clips(project_id: str, source_id: str) -> int:
    from backend.core.path_utils import get_project_clips_directory

    clips_dir = get_project_clips_directory(project_id)
    return len(list(clips_dir.glob(f"{source_id}_*.mp4")))


async def run_multi_source_queue(project_id: str, task_id: Optional[str] = None) -> Dict[str, Any]:
    """顺序处理项目内所有 pending/failed 源视频。"""
    task_id = task_id or str(uuid.uuid4())
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"success": False, "error": "项目不存在"}

        processing_config = dict(project.processing_config or {})
        pending = get_pending_sources(processing_config)
        if not pending:
            return {"success": True, "message": "没有待处理的源视频", "processed": 0}

        project.status = ProjectStatus.PROCESSING
        db.commit()

        processed = 0
        last_error: Optional[str] = None

        for source in pending:
            processing_config = mark_source_processing(processing_config, source.id)
            processing_config = set_current_source_index(processing_config, source.index)
            project.processing_config = processing_config
            db.commit()

            video_path, srt_path = source_media_paths(project_id, source)
            adapter = create_simple_pipeline_adapter(
                project_id,
                task_id,
                source_id=source.id,
                source_index=source.index,
                source_filename=source.original_filename,
            )

            logger.info(
                "多源队列：开始处理 source=%s index=%s file=%s",
                source.id,
                source.index,
                source.original_filename,
            )

            result = await adapter.process_project_sync(
                video_path,
                srt_path,
                start_from_step=None,
            )

            if result.get("status") != "succeeded":
                last_error = result.get("error") or "源视频处理失败"
                processing_config = mark_source_failed(processing_config, source.id, last_error)
                project.processing_config = processing_config
                project.status = ProjectStatus.FAILED
                db.commit()
                return {
                    "success": False,
                    "project_id": project_id,
                    "source_id": source.id,
                    "error": last_error,
                    "processed": processed,
                }

            clips_count = _count_source_clips(project_id, source.id)
            processing_config = mark_source_completed(
                processing_config, source.id, clips_count=clips_count
            )
            project.processing_config = processing_config
            db.commit()
            processed += 1

        processing_config = set_current_source_index(processing_config, None)
        project.processing_config = processing_config
        agg = aggregate_project_status(get_sources_ordered(processing_config))
        if agg == "completed":
            project.status = ProjectStatus.COMPLETED
        elif agg == "failed":
            project.status = ProjectStatus.FAILED
        else:
            project.status = ProjectStatus.PROCESSING
        db.commit()

        return {
            "success": True,
            "project_id": project_id,
            "processed": processed,
            "project_status": project.status.value,
        }
    finally:
        db.close()


def run_multi_source_queue_sync(project_id: str, task_id: Optional[str] = None) -> Dict[str, Any]:
    return asyncio.run(run_multi_source_queue(project_id, task_id=task_id))

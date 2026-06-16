"""多源项目 — 单源流水线隔离（下载、清理、重跑）。"""
from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.database import SessionLocal
from backend.core.path_utils import (
    get_project_clips_directory,
    get_project_directory,
    get_project_source_metadata_directory,
    resolve_source_srt_path,
    resolve_source_video_path,
)
from backend.models.project import Project, ProjectStatus
from backend.services.project_source_service import (
    find_source,
    is_multi_source_project,
    mark_source_completed,
    mark_source_failed,
    mark_source_processing,
    set_current_source_index,
    source_media_paths,
)
from backend.services.simple_pipeline_adapter import create_simple_pipeline_adapter

logger = logging.getLogger(__name__)

# 与 pipeline_steps_service.STEP_OUTPUTS_TO_CLEAR 对齐，但仅文件名（在 metadata/sources/{id}/ 下）
_SOURCE_METADATA_FILES: Dict[str, List[str]] = {
    "step1_outline": [
        "step1_outline.json",
        "step2_timeline.json",
        "step3_all_scored.json",
        "step3_high_score_clips.json",
        "step4_titles.json",
        "step5_collections.json",
        "clips_metadata.json",
        "collections_metadata.json",
    ],
    "step2_timeline": [
        "step2_timeline.json",
        "step3_all_scored.json",
        "step3_high_score_clips.json",
        "step4_titles.json",
        "step5_collections.json",
        "clips_metadata.json",
        "collections_metadata.json",
    ],
    "step3_scoring": [
        "step3_all_scored.json",
        "step3_high_score_clips.json",
        "step4_titles.json",
        "step5_collections.json",
        "clips_metadata.json",
        "collections_metadata.json",
    ],
    "step4_title": [
        "step4_titles.json",
        "step5_collections.json",
        "clips_metadata.json",
        "collections_metadata.json",
    ],
    "step5_clustering": [
        "step5_collections.json",
        "collections_metadata.json",
    ],
    "step6_video": ["clips_metadata.json", "collections_metadata.json"],
}

_SOURCE_METADATA_DIRS = [
    "step1_chunks",
    "step1_srt_chunks",
    "step1_llm_raw_output",
    "step2_timeline_chunks",
    "step2_llm_raw_output",
    "debug_responses",
    "resolved_prompts",
]


def _safe_unlink(path: Path) -> bool:
    try:
        if path.is_file():
            path.unlink()
            return True
    except OSError as exc:
        logger.warning("删除文件失败 %s: %s", path, exc)
    return False


def _safe_rmtree(path: Path) -> None:
    if not path.exists():
        return
    for child in sorted(path.rglob("*"), reverse=True):
        if child.is_file():
            _safe_unlink(child)
    try:
        path.rmdir()
    except OSError:
        pass


def is_source_video_ready(project_id: str, source_id: str) -> bool:
    video = resolve_source_video_path(project_id, source_id)
    return video.is_file() and video.stat().st_size > 0


def clear_source_clips(project_id: str, source_id: str) -> int:
    clips_dir = get_project_clips_directory(project_id)
    removed = 0
    if not clips_dir.exists():
        return 0
    for clip in clips_dir.glob(f"{source_id}_*.mp4"):
        if _safe_unlink(clip):
            removed += 1
    return removed


def clear_source_step_outputs(project_id: str, source_id: str, from_step_id: str) -> None:
    """仅清除指定源的步骤产物，不影响其他源或项目根 metadata。"""
    from backend.services.data_sync_service import (
        STEPS_RESET_DELETED_CLIPS,
        clear_deleted_clip_blocklist,
    )

    if from_step_id not in _SOURCE_METADATA_FILES:
        return
    if from_step_id in STEPS_RESET_DELETED_CLIPS:
        clear_deleted_clip_blocklist(get_project_directory(project_id))
    meta_dir = get_project_source_metadata_directory(project_id, source_id)
    for name in _SOURCE_METADATA_FILES[from_step_id]:
        _safe_unlink(meta_dir / name)
    if from_step_id == "step1_outline":
        for dirname in _SOURCE_METADATA_DIRS:
            _safe_rmtree(meta_dir / dirname)
    if from_step_id in {"step1_outline", "step2_timeline", "step3_scoring", "step4_title", "step5_clustering", "step6_video"}:
        clear_source_clips(project_id, source_id)
    project_dir = get_project_directory(project_id)
    _safe_unlink(project_dir / "output" / "step6_video_output.json")


def clear_legacy_root_pipeline_artifacts(project_id: str) -> None:
    """多源项目清理根目录遗留的单源流水线产物，避免与 per-source 混淆。"""
    project_dir = get_project_directory(project_id)
    meta = project_dir / "metadata"
    legacy_files = [
        "step1_outline.json",
        "step2_timeline.json",
        "step3_all_scored.json",
        "step3_high_score_clips.json",
        "step4_titles.json",
        "step5_collections.json",
        "clips_metadata.json",
        "collections_metadata.json",
    ]
    for name in legacy_files:
        _safe_unlink(meta / name)
    for dirname in _SOURCE_METADATA_DIRS:
        _safe_rmtree(meta / dirname)


def resolve_metadata_dir_for_read(
    project_dir: Path,
    processing_config: Optional[Dict[str, Any]],
    source_id: Optional[str],
    source_index: Optional[int] = None,
) -> Path:
    """读取步骤结果：优先 per-source；源 0 可回退到根 metadata（旧项目兼容）。"""
    if source_id:
        per_source = project_dir / "metadata" / "sources" / source_id
        if (per_source / "step1_outline.json").exists() or (per_source / "step2_timeline.json").exists():
            return per_source
        if is_multi_source_project(processing_config) and source_index == 0:
            root = project_dir / "metadata"
            if (root / "step1_outline.json").exists():
                return root
        return per_source
    return project_dir / "metadata"


def _count_source_clips(project_id: str, source_id: str) -> int:
    clips_dir = get_project_clips_directory(project_id)
    return len(list(clips_dir.glob(f"{source_id}_*.mp4")))


async def run_single_source_pipeline(
    project_id: str,
    source_id: str,
    *,
    task_id: Optional[str] = None,
    start_from_step: Optional[str] = None,
) -> Dict[str, Any]:
    task_id = task_id or str(uuid.uuid4())
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"success": False, "error": "项目不存在"}

        source = find_source(project.processing_config, source_id)
        if not source:
            return {"success": False, "error": "源视频不存在"}

        if not is_source_video_ready(project_id, source_id):
            return {
                "success": False,
                "error": "源视频文件不存在或为空，请先完成该链接的下载",
                "source_id": source_id,
            }

        processing_config = dict(project.processing_config or {})
        processing_config = mark_source_processing(processing_config, source_id)
        processing_config = set_current_source_index(processing_config, source.index)
        project.processing_config = processing_config
        project.status = ProjectStatus.PROCESSING
        db.commit()

        video_path, srt_path = source_media_paths(project_id, source)
        adapter = create_simple_pipeline_adapter(
            project_id,
            task_id,
            source_id=source.id,
            source_index=source.index,
            source_filename=source.original_filename,
        )
        result = await adapter.process_project_sync(
            video_path,
            srt_path,
            start_from_step=start_from_step,
        )

        processing_config = dict(project.processing_config or {})
        if result.get("status") != "succeeded":
            err = result.get("error") or "源视频处理失败"
            processing_config = mark_source_failed(processing_config, source_id, err)
            project.processing_config = processing_config
            project.status = ProjectStatus.FAILED
            db.commit()
            return {"success": False, "source_id": source_id, "error": err}

        clips_count = _count_source_clips(project_id, source_id)
        processing_config = mark_source_completed(
            processing_config, source_id, clips_count=clips_count
        )
        processing_config = set_current_source_index(processing_config, None)
        project.processing_config = processing_config
        project.status = ProjectStatus.COMPLETED
        db.commit()
        return {
            "success": True,
            "source_id": source_id,
            "clips_count": clips_count,
        }
    finally:
        db.close()


def submit_single_source_pipeline_task(
    project_id: str,
    source_id: str,
    *,
    start_from_step: Optional[str] = None,
) -> Dict[str, Any]:
    task_id = str(uuid.uuid4())

    def run() -> None:
        try:
            asyncio.run(
                run_single_source_pipeline(
                    project_id,
                    source_id,
                    task_id=task_id,
                    start_from_step=start_from_step,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("单源流水线失败 %s source=%s: %s", project_id, source_id, exc, exc_info=True)

    threading.Thread(
        target=run,
        name=f"source-pipeline-{source_id[:8]}",
        daemon=True,
    ).start()
    return {
        "success": True,
        "task_id": task_id,
        "source_id": source_id,
        "message": "已启动单源流水线",
    }


async def retry_source_download(project_id: str, source_id: str) -> Dict[str, Any]:
    """仅重试单个链接源的下载到 raw/sources/{source_id}/。"""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"success": False, "error": "项目不存在"}
        source = find_source(project.processing_config, source_id)
        if not source or not source.source_url:
            return {"success": False, "error": "该源无下载链接"}
        platform = "youtube" if source.platform == "youtube" else "bilibili"
        video_dest = resolve_source_video_path(project_id, source_id)
        srt_dest = resolve_source_srt_path(project_id, source_id)
        for path in (video_dest, srt_dest):
            if path.exists():
                try:
                    path.unlink()
                except OSError:
                    pass
        from backend.services.link_video_downloader import download_link_to_source

        await download_link_to_source(
            url=source.source_url,
            platform=platform,
            video_dest=video_dest,
            srt_dest=srt_dest,
            browser=None,
        )
        if not is_source_video_ready(project_id, source_id):
            return {"success": False, "error": "下载后视频仍不可用"}
        return {"success": True, "message": "源视频下载完成"}
    finally:
        db.close()

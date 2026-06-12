"""
流水线步骤状态与从指定步骤续跑（对接 simple_pipeline_adapter）。
"""

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.core.path_utils import get_project_directory
from backend.core.shared_config import MIN_SCORE_THRESHOLD
from backend.services.simple_progress import (
    get_progress_snapshot,
    get_stage_display_name,
)

logger = logging.getLogger(__name__)

STEP_ORDER = [
    "download",
    "step1_outline",
    "step2_timeline",
    "step3_scoring",
    "step4_title",
    "step5_clustering",
    "step6_video",
]

STAGE_TO_STEP = {
    "INGEST": "download",
    "SUBTITLE": "step1_outline",
    "ANALYZE": "step2_timeline",
    "HIGHLIGHT": "step4_title",
    "EXPORT": "step6_video",
    "DONE": "step6_video",
}


@dataclass(frozen=True)
class StepDefinition:
    id: str
    name: str
    description: str
    output_rel: Optional[str] = None
    output_is_array: bool = True
    progress_stage: Optional[str] = None


STEP_DEFINITIONS: List[StepDefinition] = [
    StepDefinition(
        "download",
        "视频获取",
        "下载链接视频，或确认本地上传文件已就绪",
        "raw/input.mp4",
        False,
        "INGEST",
    ),
    StepDefinition(
        "step1_outline",
        "大纲提取",
        "从字幕中提炼结构性话题大纲",
        "metadata/step1_outline.json",
        True,
        "SUBTITLE",
    ),
    StepDefinition(
        "step2_timeline",
        "时间线定位",
        "为每个话题匹配字幕中的起止时间",
        "metadata/step2_timeline.json",
        True,
        "ANALYZE",
    ),
    StepDefinition(
        "step3_scoring",
        "内容评分",
        "对话题片段进行质量评分并筛选高分内容",
        "metadata/step3_high_score_clips.json",
        True,
        "ANALYZE",
    ),
    StepDefinition(
        "step4_title",
        "标题生成",
        "为高分片段生成推荐标题",
        "metadata/step4_titles.json",
        True,
        "HIGHLIGHT",
    ),
    StepDefinition(
        "step5_clustering",
        "主题聚类",
        "将相关片段聚合为 AI 推荐合集",
        "metadata/step5_collections.json",
        True,
        "HIGHLIGHT",
    ),
    StepDefinition(
        "step6_video",
        "视频切割",
        "导出切片视频与合集视频文件",
        "output/step6_video_output.json",
        False,
        "EXPORT",
    ),
]

STEP_BY_ID = {s.id: s for s in STEP_DEFINITIONS}

# 超过此时间无进度更新且进程内无 worker，视为卡住
STALE_PIPELINE_SECONDS = 120

# 从某步续跑时需要清除的输出（含该步及之后）
STEP_OUTPUTS_TO_CLEAR: Dict[str, List[str]] = {
    "step1_outline": [
        "metadata/step1_outline.json",
        "metadata/step2_timeline.json",
        "metadata/step3_all_scored.json",
        "metadata/step3_high_score_clips.json",
        "metadata/step4_titles.json",
        "metadata/step5_collections.json",
        "metadata/clips_metadata.json",
        "metadata/collections_metadata.json",
        "output/step6_video_output.json",
    ],
    "step2_timeline": [
        "metadata/step2_timeline.json",
        "metadata/step3_all_scored.json",
        "metadata/step3_high_score_clips.json",
        "metadata/step4_titles.json",
        "metadata/step5_collections.json",
        "metadata/clips_metadata.json",
        "metadata/collections_metadata.json",
        "output/step6_video_output.json",
    ],
    "step3_scoring": [
        "metadata/step3_all_scored.json",
        "metadata/step3_high_score_clips.json",
        "metadata/step4_titles.json",
        "metadata/step5_collections.json",
        "metadata/clips_metadata.json",
        "metadata/collections_metadata.json",
        "output/step6_video_output.json",
    ],
    "step4_title": [
        "metadata/step4_titles.json",
        "metadata/step5_collections.json",
        "metadata/clips_metadata.json",
        "metadata/collections_metadata.json",
        "output/step6_video_output.json",
    ],
    "step5_clustering": [
        "metadata/step5_collections.json",
        "metadata/collections_metadata.json",
        "output/step6_video_output.json",
    ],
    "step6_video": [
        "output/step6_video_output.json",
        "metadata/clips_metadata.json",
        "metadata/collections_metadata.json",
    ],
}

# step6 续跑时额外清理的媒体目录（旧切片不删会导致播放路径错乱）
STEP6_MEDIA_DIRS = [
    "output/clips",
    "output/collections",
]

# 从某步执行时，该步所需的输入文件（仅检查直接依赖，不要求其后步骤未完成）
STEP_INPUT_FILES: Dict[str, List[str]] = {
    "step1_outline": ["raw/input.srt"],
    "step2_timeline": ["metadata/step1_outline.json"],
    "step3_scoring": ["metadata/step2_timeline.json"],
    "step4_title": ["metadata/step3_high_score_clips.json"],
    "step5_clustering": ["metadata/step4_titles.json"],
    "step6_video": ["metadata/step4_titles.json", "metadata/step5_collections.json"],
}

def _read_json_output(path: Path, is_array: bool) -> Tuple[bool, int, str]:
    if not path.exists():
        return False, 0, "尚未生成"
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return False, 0, "文件为空"
        data = json.loads(raw)
        if is_array:
            if not isinstance(data, list) or len(data) == 0:
                return False, 0, "无有效数据"
            return True, len(data), f"{len(data)} 条"
        if isinstance(data, dict):
            clips = int(data.get("clips_generated") or 0)
            collections = int(data.get("collections_generated") or 0)
            total = clips + collections
            if total <= 0:
                return False, 0, "未生成切片"
            return True, clips, f"{clips} 个切片"
        return False, 0, "格式无效"
    except Exception as exc:
        logger.warning("读取步骤输出失败 %s: %s", path, exc)
        return False, 0, "读取失败"


def _video_ready(project_dir: Path) -> Tuple[bool, str]:
    video = project_dir / "raw" / "input.mp4"
    if video.exists() and video.stat().st_size > 0:
        return True, "视频文件已就绪"
    return False, "视频文件不存在"


def _infer_running_step(progress: Optional[Dict[str, Any]], project_status: str) -> Optional[str]:
    if project_status not in ("processing", "pending"):
        return None
    if not progress:
        return None
    stage = progress.get("stage") or ""
    # DONE 表示流水线已结束（成功或失败），不应再显示某步「执行中」
    if stage == "DONE":
        return None
    if stage in STAGE_TO_STEP:
        return STAGE_TO_STEP[stage]
    return None


def _has_active_pipeline_worker(project_id: str) -> bool:
    """当前 Python 进程内是否仍有流水线线程在跑（桌面模式）。"""
    try:
        from backend.tasks.processing import _active_pipeline_lock, _active_pipeline_projects

        with _active_pipeline_lock:
            return project_id in _active_pipeline_projects
    except Exception:
        return False


def _clear_active_pipeline_worker(project_id: str) -> None:
    try:
        from backend.tasks.processing import _active_pipeline_lock, _active_pipeline_projects

        with _active_pipeline_lock:
            _active_pipeline_projects.discard(project_id)
    except Exception:
        pass


def _has_running_db_task(db: Session, project_id: str) -> bool:
    from backend.models.task import Task, TaskStatus

    return (
        db.query(Task)
        .filter(
            Task.project_id == project_id,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.RUNNING]),
        )
        .first()
        is not None
    )


def _is_downloading(project: Any, project_id: Optional[str] = None) -> bool:
    """
    是否仍在下载视频。
    download_status 可能未回写 completed，以 raw/input.mp4 是否就绪为准。
    """
    cfg = project.processing_config or {}
    if cfg.get("download_status") != "downloading":
        return False
    pid = project_id or str(getattr(project, "id", ""))
    if not pid:
        return True
    project_dir = get_project_directory(pid)
    video_ok, _ = _video_ready(project_dir)
    return not video_ok


def _heal_stale_download_status(db: Session, project: Any, project_id: str) -> bool:
    """视频已就绪但 download_status 仍停留在 downloading 时自动修正。"""
    cfg = dict(project.processing_config or {})
    if cfg.get("download_status") != "downloading":
        return False
    project_dir = get_project_directory(project_id)
    if not _video_ready(project_dir)[0]:
        return False
    cfg["download_status"] = "completed"
    cfg["download_progress"] = 100.0
    cfg.pop("download_message", None)
    project.processing_config = cfg
    project.updated_at = datetime.utcnow()
    db.commit()
    logger.info("项目 %s download_status 已从 downloading 修正为 completed", project_id)
    return True


def _is_desktop_mode() -> bool:
    import os

    return os.getenv("AUTOCLIP_DESKTOP_MODE", "").lower() in {"1", "true", "yes"}


def _is_db_task_live(db: Session, project_id: str, max_age_seconds: int = 120) -> bool:
    """Celery 模式下：仅当 DB 任务近期有更新才视为仍在执行。"""
    from backend.models.task import Task, TaskStatus

    task = (
        db.query(Task)
        .filter(
            Task.project_id == project_id,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.RUNNING]),
        )
        .order_by(Task.updated_at.desc())
        .first()
    )
    if not task:
        return False
    ref = task.updated_at or task.started_at
    if not ref:
        return True
    age = (datetime.utcnow() - ref.replace(tzinfo=None)).total_seconds()
    return age < max_age_seconds


def _cleanup_orphaned_pipeline_locks(db: Session, project_id: str, project: Any) -> int:
    """
    清理无真实 worker 支撑的执行锁（遗留 DB 任务 / 进程内僵尸标记）。
    返回取消的任务数。
    """
    _heal_stale_download_status(db, project, project_id)

    if _is_downloading(project, project_id):
        return 0

    cancelled = 0
    has_worker = _has_active_pipeline_worker(project_id)
    has_db = _has_running_db_task(db, project_id)

    if has_worker and has_db:
        progress = get_progress_snapshot(project_id)
        progress_ts = int(progress.get("ts") or 0) if progress else 0
        progress_stale = not progress_ts or (time.time() - progress_ts > STALE_PIPELINE_SECONDS)
        if progress_stale and not _is_db_task_live(db, project_id):
            _clear_active_pipeline_worker(project_id)
            cancelled = _cancel_orphaned_tasks(
                db,
                project_id,
                "任务长时间无进度，清理以便重新执行",
            )
            db.commit()
            logger.info("项目 %s 清理僵死 worker+DB 任务 %d 个", project_id, cancelled)
            has_worker = False
            has_db = _has_running_db_task(db, project_id)

    if has_worker and not has_db:
        _clear_active_pipeline_worker(project_id)
        logger.info("项目 %s 清除无 DB 任务对应的 worker 标记", project_id)

    if not has_worker and has_db:
        if _is_desktop_mode() or not _is_db_task_live(db, project_id):
            cancelled = _cancel_orphaned_tasks(
                db,
                project_id,
                "无活跃进程，清理遗留任务以便重新执行",
            )
            db.commit()
            logger.info("项目 %s 清理 %d 个遗留 DB 任务", project_id, cancelled)

    if not _has_active_pipeline_worker(project_id):
        _clear_active_pipeline_worker(project_id)

    return cancelled


def _is_pipeline_running(project_id: str, project: Any, db: Optional[Session] = None) -> bool:
    """
    判断流水线是否真正在跑。
    桌面模式：以进程内 worker 为准；无 worker 时不认 DB 里的 RUNNING 僵尸任务。
    """
    if _is_downloading(project, project_id):
        return True
    if _has_active_pipeline_worker(project_id):
        return True
    if db is not None and _has_running_db_task(db, project_id):
        if _is_desktop_mode():
            return False
        return _is_db_task_live(db, project_id)
    return False


def _prepare_pipeline_for_step_run(db: Session, project_id: str, project: Any) -> None:
    """续跑/查询步骤前：清理僵尸锁并修正 processing 状态。"""
    _cleanup_orphaned_pipeline_locks(db, project_id, project)
    reconcile_stale_pipeline_state(db, project_id, project)
    db.refresh(project)


def _cancel_orphaned_tasks(db: Session, project_id: str, reason: str) -> int:
    from backend.models.task import Task, TaskStatus

    tasks = (
        db.query(Task)
        .filter(
            Task.project_id == project_id,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.RUNNING]),
        )
        .all()
    )
    for task in tasks:
        task.status = TaskStatus.CANCELLED
        task.error_message = reason
        task.updated_at = datetime.utcnow()
    return len(tasks)


def _resolve_status_after_interruption(project_dir: Path, progress: Optional[Dict[str, Any]]):
    """服务中断后，根据现有产物推断项目应处于的状态。"""
    from backend.models.project import ProjectStatus

    if progress:
        msg = progress.get("message") or ""
        if progress.get("stage") == "DONE" and "失败" in msg:
            return ProjectStatus.FAILED

    step6_ok, _, _ = _step_completed(STEP_BY_ID["step6_video"], project_dir)
    if step6_ok:
        return ProjectStatus.COMPLETED

    # 仅 step6 被清除重跑时中断：前置步骤仍在，允许用户再次续跑 step6
    step5_ok, _, _ = _step_completed(STEP_BY_ID["step5_clustering"], project_dir)
    if step5_ok:
        return ProjectStatus.COMPLETED

    return ProjectStatus.FAILED


def reconcile_project_status_from_artifacts(db: Session, project_id: str, project: Any) -> bool:
    """
    磁盘上 step6 已产出切片时，将 failed/processing 等项目修正为 completed，并同步 DB。
    """
    from backend.models.project import ProjectStatus
    from backend.services.data_sync_service import DataSyncService

    status_val = getattr(project.status, "value", str(project.status))
    project_dir = get_project_directory(project_id)
    step6_ok, clip_count, _ = _step_completed(STEP_BY_ID["step6_video"], project_dir)
    if not step6_ok or clip_count <= 0:
        return False

    changed = False
    if status_val != ProjectStatus.COMPLETED.value:
        project.status = ProjectStatus.COMPLETED
        project.updated_at = datetime.utcnow()
        if not project.completed_at:
            project.completed_at = datetime.utcnow()
        changed = True
        logger.info(
            "项目 %s 检测到 %d 个切片产物，状态由 %s 修正为 completed",
            project_id,
            clip_count,
            status_val,
        )

    try:
        sync_service = DataSyncService(db)
        sync_service.sync_project_from_filesystem(project_id, project_dir)
    except Exception as exc:
        logger.warning("项目 %s 同步切片到数据库失败: %s", project_id, exc)

    if changed:
        db.commit()
    return changed


def reconcile_stale_pipeline_state(db: Session, project_id: str, project: Any) -> bool:
    """
    修复「服务重启 / 任务进程丢失」导致的 processing 卡住。
    返回 True 表示已修正 DB 状态。
    """
    from backend.models.project import ProjectStatus

    project_status = getattr(project.status, "value", str(project.status))
    if project_status != "processing":
        return False

    if _has_active_pipeline_worker(project_id):
        return False

    project_dir = get_project_directory(project_id)
    progress = get_progress_snapshot(project_id)

    from backend.models.task import Task, TaskStatus

    active_tasks = (
        db.query(Task)
        .filter(
            Task.project_id == project_id,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.RUNNING]),
        )
        .all()
    )

    # processing 但无 worker、无 DB 任务 → 立即修正（不等 stale 超时）
    if not active_tasks:
        new_status = _resolve_status_after_interruption(project_dir, progress)
        _clear_active_pipeline_worker(project_id)
        project.status = new_status
        project.updated_at = datetime.utcnow()
        if new_status == ProjectStatus.COMPLETED and not project.completed_at:
            project.completed_at = datetime.utcnow()
        db.commit()
        logger.warning(
            "项目 %s 标记为 processing 但无活跃任务，已修正为 %s",
            project_id,
            new_status.value,
        )
        return True

    if progress and progress.get("stage") == "DONE":
        new_status = _resolve_status_after_interruption(project_dir, progress)
        _cancel_orphaned_tasks(db, project_id, "流水线已结束，清理遗留任务")
        project.status = new_status
        project.updated_at = datetime.utcnow()
        if new_status == ProjectStatus.COMPLETED and not project.completed_at:
            project.completed_at = datetime.utcnow()
        db.commit()
        logger.info("项目 %s 进度已为 DONE，状态修正为 %s", project_id, new_status.value)
        return True

    progress_ts = int(progress.get("ts") or 0) if progress else 0
    progress_age = time.time() - progress_ts if progress_ts else float("inf")

    if active_tasks and not _has_active_pipeline_worker(project_id):
        cancelled = _cancel_orphaned_tasks(
            db,
            project_id,
            "流水线任务因服务重启或进程丢失中断，已自动取消",
        )
        new_status = _resolve_status_after_interruption(project_dir, progress)
        _clear_active_pipeline_worker(project_id)
        project.status = new_status
        project.updated_at = datetime.utcnow()
        if new_status == ProjectStatus.COMPLETED and not project.completed_at:
            project.completed_at = datetime.utcnow()
        db.commit()
        logger.warning(
            "项目 %s 无活跃 worker 但有 %d 个遗留任务，状态修正为 %s",
            project_id,
            cancelled,
            new_status.value,
        )
        return True

    if not active_tasks and progress_age > STALE_PIPELINE_SECONDS:
        # 理论上已在上方「无 active_tasks」分支处理，保留作兜底
        new_status = _resolve_status_after_interruption(project_dir, progress)
        _clear_active_pipeline_worker(project_id)
        project.status = new_status
        project.updated_at = datetime.utcnow()
        if new_status == ProjectStatus.COMPLETED and not project.completed_at:
            project.completed_at = datetime.utcnow()
        db.commit()
        logger.warning(
            "项目 %s 处于 processing 但无活跃任务，已修正为 %s",
            project_id,
            new_status.value,
        )
        return True

    if active_tasks and progress_age > STALE_PIPELINE_SECONDS:
        cancelled = _cancel_orphaned_tasks(
            db,
            project_id,
            "流水线任务因长时间无进度更新而中断，已自动取消",
        )
        new_status = _resolve_status_after_interruption(project_dir, progress)
        _clear_active_pipeline_worker(project_id)
        project.status = new_status
        project.updated_at = datetime.utcnow()
        if new_status == ProjectStatus.COMPLETED and not project.completed_at:
            project.completed_at = datetime.utcnow()
        db.commit()
        logger.warning(
            "项目 %s 流水线卡住（取消 %d 个遗留任务），状态修正为 %s",
            project_id,
            cancelled,
            new_status.value,
        )
        return True

    return False


def reset_stuck_pipeline(db: Session, project_id: str, project: Any) -> Dict[str, Any]:
    """手动解除流水线卡住状态，便于从某步重新续跑。"""
    from backend.models.project import ProjectStatus

    project_dir = get_project_directory(project_id)
    _cleanup_orphaned_pipeline_locks(db, project_id, project)
    reconcile_stale_pipeline_state(db, project_id, project)
    db.refresh(project)

    if _is_pipeline_running(project_id, project, db):
        raise ValueError("流水线仍在执行中，请稍后再试")

    cancelled = _cancel_orphaned_tasks(db, project_id, "用户手动解除卡住状态")
    new_status = _resolve_status_after_interruption(project_dir, get_progress_snapshot(project_id))
    project.status = new_status
    project.updated_at = datetime.utcnow()
    if new_status == ProjectStatus.COMPLETED and not project.completed_at:
        project.completed_at = datetime.utcnow()
    db.commit()

    return {
        "success": True,
        "project_id": project_id,
        "cancelled_tasks": cancelled,
        "new_status": new_status.value,
        "message": "已解除卡住状态，可从此步继续",
    }


def _step_completed(defn: StepDefinition, project_dir: Path) -> Tuple[bool, int, str]:
    if defn.id == "download":
        ok, msg = _video_ready(project_dir)
        return ok, 1 if ok else 0, msg
    if not defn.output_rel:
        return False, 0, "未知步骤"
    path = project_dir / defn.output_rel
    return _read_json_output(path, defn.output_is_array)


def get_pipeline_steps(project_id: str, project: Any, db: Optional[Session] = None) -> Dict[str, Any]:
    stale_recovered = False
    if db is not None:
        try:
            if _heal_stale_download_status(db, project, project_id):
                db.refresh(project)
            cancelled = _cleanup_orphaned_pipeline_locks(db, project_id, project)
            stale_recovered = reconcile_stale_pipeline_state(db, project_id, project)
            artifact_recovered = reconcile_project_status_from_artifacts(db, project_id, project)
            if stale_recovered or cancelled or artifact_recovered:
                db.refresh(project)
        except Exception as exc:
            logger.warning("自动修复卡住流水线失败 %s: %s", project_id, exc)

    project_dir = get_project_directory(project_id)
    progress = get_progress_snapshot(project_id)
    project_status = getattr(project.status, "value", str(project.status))
    is_pipeline_running = _is_pipeline_running(project_id, project, db)
    running_step = _infer_running_step(progress, project_status) if is_pipeline_running else None

    processing_config = project.processing_config or {}
    download_status = processing_config.get("download_status")
    download_progress = processing_config.get("download_progress")
    download_message = processing_config.get("download_message") or processing_config.get("error_message")

    steps_out: List[Dict[str, Any]] = []
    found_running = False

    for defn in STEP_DEFINITIONS:
        completed, count, detail = _step_completed(defn, project_dir)
        status = "pending"
        message = detail

        # 视频获取：以 raw/input.mp4 是否存在为准；processing_config 里的
        # download_status 可能一直停留在 downloading（下载完成后未回写 completed）。
        if defn.id == "download" and completed:
            status = "completed"
            message = detail
        elif defn.id == "download" and download_status == "failed":
            status = "failed"
            message = download_message or "下载失败"
        elif defn.id == "download" and _is_downloading(project, project_id):
            status = "running"
            message = download_message or f"下载中 {download_progress or 0}%"
        elif running_step == defn.id and not found_running and defn.id != "download":
            status = "running"
            message = progress.get("message") or get_stage_display_name(defn.progress_stage or "")
            found_running = True
        elif completed:
            status = "completed"
        elif defn.id != "download" and not _video_ready(project_dir)[0]:
            status = "skipped"
            message = "需先完成视频获取"
        else:
            # 前置步骤是否都完成
            idx = STEP_ORDER.index(defn.id)
            prereq_ok = True
            for prev_id in STEP_ORDER[:idx]:
                prev_def = STEP_BY_ID[prev_id]
                prev_ok, _, _ = _step_completed(prev_def, project_dir)
                if not prev_ok:
                    prereq_ok = False
                    break
            if not prereq_ok and defn.id != "download":
                status = "pending"
                message = "等待前置步骤"

        can_run, blocked = _can_run_step(defn.id, project_dir, project, is_pipeline_running)

        steps_out.append(
            {
                "id": defn.id,
                "name": defn.name,
                "description": defn.description,
                "status": status,
                "item_count": count if completed else None,
                "message": message,
                "can_run": can_run,
                "run_blocked_reason": blocked,
            }
        )

    return {
        "project_id": project_id,
        "project_status": project_status,
        "is_pipeline_running": is_pipeline_running,
        "stale_recovered": stale_recovered,
        "progress": progress,
        "steps": steps_out,
    }


def _format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    if size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def _outline_title(outline: Any) -> str:
    if isinstance(outline, dict):
        return str(outline.get("title") or outline.get("outline") or "未知话题")
    return str(outline or "未知话题")


def _load_json_file(path: Path) -> Any:
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return None
    return json.loads(raw)


def _media_entry(label: str, path: Path, project_dir: Path) -> Dict[str, Any]:
    try:
        rel_path = str(path.relative_to(project_dir))
    except ValueError:
        rel_path = str(path)
    if path.exists() and path.stat().st_size > 0:
        return {
            "label": label,
            "path": rel_path,
            "detail": _format_file_size(path.stat().st_size),
            "ready": True,
        }
    return {"label": label, "path": rel_path, "detail": "未就绪", "ready": False}


def get_pipeline_step_result(project_id: str, step_id: str, project: Any) -> Dict[str, Any]:
    if step_id not in STEP_BY_ID:
        raise ValueError(f"无效步骤: {step_id}")

    project_dir = get_project_directory(project_id)
    defn = STEP_BY_ID[step_id]
    metadata_dir = project_dir / "metadata"

    if step_id == "download":
        video_path = project_dir / "raw" / "input.mp4"
        srt_path = project_dir / "raw" / "input.srt"
        source_url = None
        if getattr(project, "project_metadata", None):
            source_url = project.project_metadata.get("source_url")
        items = [
            _media_entry("视频文件", video_path, project_dir),
            _media_entry("字幕文件", srt_path, project_dir),
            {
                "label": "来源",
                "path": source_url or "本地上传",
                "detail": "URL 导入" if source_url else "本地文件",
                "ready": bool(source_url or video_path.exists()),
            },
        ]
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "media_info",
            "available": any(item.get("ready") for item in items[:2]),
            "items": items,
        }

    if not defn.output_rel:
        raise ValueError("该步骤无输出结果")

    output_path = project_dir / defn.output_rel
    if not output_path.exists():
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "empty",
            "available": False,
            "message": "尚未生成结果",
            "items": [],
        }

    if step_id == "step1_outline":
        data = _load_json_file(output_path)
        if not isinstance(data, list):
            raise ValueError("大纲数据格式无效")
        items = [
            {
                "index": i + 1,
                "title": item.get("title", "未知话题"),
                "subtopics": item.get("subtopics") or [],
                "chunk_index": item.get("chunk_index"),
            }
            for i, item in enumerate(data)
        ]
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "outline_list",
            "available": len(items) > 0,
            "items": items,
        }

    if step_id == "step2_timeline":
        data = _load_json_file(output_path)
        if not isinstance(data, list):
            raise ValueError("时间线数据格式无效")
        items = [
            {
                "id": item.get("id"),
                "title": _outline_title(item.get("outline")),
                "start_time": item.get("start_time"),
                "end_time": item.get("end_time"),
                "chunk_index": item.get("chunk_index"),
            }
            for item in data
        ]
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "timeline_list",
            "available": len(items) > 0,
            "items": items,
        }

    if step_id == "step3_scoring":
        all_scored_path = metadata_dir / "step3_all_scored.json"
        data = _load_json_file(all_scored_path) or _load_json_file(output_path)
        if not isinstance(data, list):
            raise ValueError("评分数据格式无效")
        items = []
        for item in data:
            score = float(item.get("final_score") or 0)
            content = item.get("content")
            if isinstance(content, list):
                content_preview = " ".join(str(c) for c in content[:3])
                if len(content) > 3:
                    content_preview += "…"
            else:
                content_preview = str(content or "")[:200]
            items.append(
                {
                    "id": item.get("id"),
                    "title": _outline_title(item.get("outline")),
                    "score": score,
                    "passed": score >= MIN_SCORE_THRESHOLD,
                    "recommend_reason": item.get("recommend_reason") or "",
                    "start_time": item.get("start_time"),
                    "end_time": item.get("end_time"),
                    "content_preview": content_preview,
                }
            )
        high_count = sum(1 for item in items if item["passed"])
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "score_list",
            "available": len(items) > 0,
            "meta": {
                "threshold": MIN_SCORE_THRESHOLD,
                "high_score_count": high_count,
                "total_count": len(items),
            },
            "items": items,
        }

    if step_id == "step4_title":
        data = _load_json_file(output_path)
        if not isinstance(data, list):
            raise ValueError("标题数据格式无效")
        items = [
            {
                "id": item.get("id"),
                "original_title": _outline_title(item.get("outline")),
                "generated_title": item.get("generated_title") or _outline_title(item.get("outline")),
                "score": item.get("final_score"),
                "recommend_reason": item.get("recommend_reason") or "",
            }
            for item in data
        ]
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "title_list",
            "available": len(items) > 0,
            "items": items,
        }

    if step_id == "step5_clustering":
        data = _load_json_file(output_path)
        if not isinstance(data, list):
            raise ValueError("合集数据格式无效")
        items = [
            {
                "id": item.get("id"),
                "title": item.get("collection_title") or item.get("title") or "未命名合集",
                "summary": item.get("collection_summary") or item.get("summary") or "",
                "clip_ids": item.get("clip_ids") or [],
            }
            for item in data
        ]
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "collection_list",
            "available": len(items) > 0,
            "items": items,
        }

    if step_id == "step6_video":
        data = _load_json_file(output_path)
        if not isinstance(data, dict):
            raise ValueError("导出数据格式无效")
        clip_paths = data.get("clip_paths") or []
        collection_paths = data.get("collection_paths") or []
        collections_info = data.get("collections_info") or []
        items: List[Dict[str, Any]] = []
        for i, path in enumerate(clip_paths):
            items.append({"type": "clip", "index": i + 1, "path": path})
        for i, info in enumerate(collections_info):
            items.append(
                {
                    "type": "collection",
                    "index": i + 1,
                    "title": info.get("title") or info.get("collection_title") or f"合集 {i + 1}",
                    "path": info.get("video_path") or (collection_paths[i] if i < len(collection_paths) else ""),
                    "clip_count": len(info.get("clip_ids") or []),
                }
            )
        return {
            "step_id": step_id,
            "step_name": defn.name,
            "result_type": "export_summary",
            "available": bool(items),
            "summary": {
                "clips_generated": int(data.get("clips_generated") or 0),
                "collections_generated": int(data.get("collections_generated") or 0),
            },
            "items": items,
        }

    raise ValueError(f"未支持的步骤: {step_id}")


def _resolve_media_paths(project: Any, project_dir: Path) -> Tuple[str, Optional[str]]:
    video_path = project_dir / "raw" / "input.mp4"
    if not video_path.exists() and project.video_path:
        alt = Path(project.video_path)
        if alt.exists():
            video_path = alt
    srt_path = project_dir / "raw" / "input.srt"
    if project.processing_config and project.processing_config.get("subtitle_path"):
        alt = Path(project.processing_config["subtitle_path"])
        if alt.exists():
            srt_path = alt
    return str(video_path), str(srt_path) if srt_path.exists() else None


def _step_inputs_ready(step_id: str, project_dir: Path, project: Any) -> Tuple[bool, Optional[str]]:
    """检查从该步执行所需的直接输入是否就绪。"""
    if step_id == "download":
        return True, None

    if not _video_ready(project_dir)[0]:
        return False, "请先完成视频获取"

    required = STEP_INPUT_FILES.get(step_id, [])
    if step_id == "step1_outline":
        _, srt_path = _resolve_media_paths(project, project_dir)
        if srt_path:
            return True, None
        # 视频已就绪时，流水线会在大纲提取前自动用 Whisper 生成字幕
        if _video_ready(project_dir)[0]:
            return True, None
        return False, "缺少字幕文件，无法执行大纲提取"

    missing: List[str] = []
    for rel in required:
        if not (project_dir / rel).exists():
            missing.append(rel)
    if missing:
        step_names = {
            "metadata/step1_outline.json": "大纲提取",
            "metadata/step2_timeline.json": "时间线定位",
            "metadata/step3_high_score_clips.json": "内容评分",
            "metadata/step4_titles.json": "标题生成",
            "metadata/step5_collections.json": "主题聚类",
        }
        hint = step_names.get(missing[0], missing[0])
        return False, f"缺少「{hint}」输出，请先完成前置步骤"
    return True, None


def _can_run_step(
    step_id: str,
    project_dir: Path,
    project: Any,
    pipeline_running: bool,
) -> Tuple[bool, Optional[str]]:
    if pipeline_running:
        return False, "流水线正在执行中"
    if step_id not in STEP_BY_ID:
        return False, "未知步骤"
    if step_id == "download":
        source_url = None
        if getattr(project, "project_metadata", None):
            source_url = project.project_metadata.get("source_url")
        if source_url:
            return True, None
        return False, "本地上传项目无需重新下载"
    return _step_inputs_ready(step_id, project_dir, project)


def clear_step_outputs(project_id: str, from_step_id: str) -> None:
    if from_step_id not in STEP_OUTPUTS_TO_CLEAR:
        return
    project_dir = get_project_directory(project_id)
    for rel in STEP_OUTPUTS_TO_CLEAR[from_step_id]:
        path = project_dir / rel
        if path.exists():
            path.unlink()
            logger.info("已清除步骤输出: %s", path)
    if from_step_id == "step6_video":
        for rel_dir in STEP6_MEDIA_DIRS:
            media_dir = project_dir / rel_dir
            if not media_dir.exists():
                continue
            for f in media_dir.iterdir():
                if f.is_file():
                    f.unlink()
                    logger.info("已清除旧切片文件: %s", f)


def run_pipeline_from_step(
    db: Session,
    project_id: str,
    step_id: str,
    force: bool = True,
) -> Dict[str, Any]:
    if step_id not in STEP_BY_ID:
        raise ValueError(f"无效步骤: {step_id}")

    from backend.models.project import Project, ProjectStatus

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError("项目不存在")

    _prepare_pipeline_for_step_run(db, project_id, project)

    project_dir = get_project_directory(project_id)
    pipeline_running = _is_pipeline_running(project_id, project, db)
    can_run, blocked = _can_run_step(step_id, project_dir, project, pipeline_running)
    if not can_run:
        raise ValueError(blocked or "当前无法执行该步骤")

    if step_id == "download":
        return _trigger_download_retry(db, project)

    if force:
        clear_step_outputs(project_id, step_id)

    project.status = ProjectStatus.PROCESSING
    db.commit()

    video_path, srt_path = _resolve_media_paths(project, project_dir)

    from backend.utils.task_submission_utils import submit_video_pipeline_task
    submit_video_pipeline_task(
        project_id,
        video_path,
        srt_path or "",
        start_from_step=step_id,
    )

    return {
        "success": True,
        "message": f"已从「{STEP_BY_ID[step_id].name}」启动流水线",
        "project_id": project_id,
        "start_step": step_id,
    }


def _trigger_download_retry(db: Session, project: Any) -> Dict[str, Any]:
    """URL 导入项目重新下载视频。"""
    from backend.services.project_service import ProjectService
    from backend.schemas.project import ProjectStatus

    project_id = str(project.id)
    source_url = None
    if getattr(project, "project_metadata", None):
        source_url = project.project_metadata.get("source_url")
    if not source_url:
        raise ValueError("本地上传项目无法重新下载")

    project_service = ProjectService(db)
    project.status = ProjectStatus.PENDING
    if project.processing_config:
        project.processing_config.update(
            {
                "download_status": "downloading",
                "download_progress": 0.0,
                "download_message": "正在重新下载…",
            }
        )
    db.commit()

    import asyncio
    from backend.api.v1.async_task_manager import task_manager

    if "bilibili.com" in source_url:
        from backend.api.v1.bilibili import (
            BilibiliDownloadRequest,
            BilibiliDownloadTask,
            download_tasks,
            process_download_task,
        )
        import uuid
        from datetime import datetime

        download_task_id = str(uuid.uuid4())
        download_request = BilibiliDownloadRequest(
            url=source_url,
            project_name=project.name,
            video_category=(project.project_metadata or {}).get("category", "general"),
        )
        download_tasks[download_task_id] = BilibiliDownloadTask(
            id=download_task_id,
            url=source_url,
            project_name=project.name,
            video_category=(project.project_metadata or {}).get("category", "general"),
            status="pending",
            progress=0.0,
            project_id=project_id,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
        )

        async def _start():
            await task_manager.create_safe_task(
                f"bilibili_redownload_{download_task_id}",
                process_download_task,
                download_task_id,
                download_request,
                project_id,
            )

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_start())
        except RuntimeError:
            asyncio.run(_start())

    elif "youtube.com" in source_url or "youtu.be" in source_url:
        from backend.api.v1.youtube import (
            YouTubeDownloadRequest,
            YouTubeDownloadTask,
            download_tasks,
            process_youtube_download_task,
        )
        import uuid
        from datetime import datetime

        download_task_id = str(uuid.uuid4())
        download_request = YouTubeDownloadRequest(
            url=source_url,
            project_name=project.name,
            video_category=(project.project_metadata or {}).get("category", "general"),
        )
        download_tasks[download_task_id] = YouTubeDownloadTask(
            id=download_task_id,
            url=source_url,
            project_name=project.name,
            video_category=(project.project_metadata or {}).get("category", "general"),
            status="pending",
            progress=0.0,
            project_id=project_id,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
        )

        async def _start():
            await task_manager.create_safe_task(
                f"youtube_redownload_{download_task_id}",
                process_youtube_download_task,
                download_task_id,
                download_request,
                project_id,
            )

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_start())
        except RuntimeError:
            asyncio.run(_start())
    else:
        raise ValueError(f"不支持的视频源: {source_url}")

    return {
        "success": True,
        "message": "已开始重新下载视频",
        "project_id": project_id,
        "start_step": "download",
    }

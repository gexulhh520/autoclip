"""多链接单项目：顺序下载 + 多源流水线。"""
from __future__ import annotations

import copy
import logging
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.database import SessionLocal
from backend.core.path_utils import get_project_directory, get_project_raw_directory
from backend.pipeline.template_engine import TemplateNotFoundError, merge_template_settings, validate_template_id
from backend.schemas.project import ProjectCreate, ProjectStatus, ProjectType
from backend.services.link_video_downloader import download_link_to_source, fetch_link_title
from backend.services.project_service import ProjectService
from backend.services.project_source_service import (
    assign_source_paths,
    attach_multi_source_to_config,
    build_source_records_from_links,
    ensure_source_raw_dir,
    mark_source_failed,
)
from backend.utils.link_url_utils import LinkPlatform, parse_link_urls, validate_link_urls
from backend.utils.task_submission_utils import submit_multi_source_project_task

logger = logging.getLogger(__name__)

_link_batch_tasks: Dict[str, "LinkBatchDownloadTask"] = {}


@dataclass
class LinkBatchDownloadTask:
    id: str
    project_id: str
    project_name: str
    total_urls: int
    status: str = "pending"
    progress: float = 0.0
    message: str = "等待下载"
    completed_urls: int = 0
    current_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "project_name": self.project_name,
            "total_urls": self.total_urls,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "completed_urls": self.completed_urls,
            "current_url": self.current_url,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def get_link_batch_task(task_id: str) -> Optional[LinkBatchDownloadTask]:
    return _link_batch_tasks.get(task_id)


async def create_link_batch_project(
    *,
    urls_raw: str | List[str],
    project_name: str,
    video_category: Optional[str],
    clip_duration_preset: Optional[str],
    clip_min_seconds: Optional[int],
    clip_target_seconds: Optional[int],
    clip_max_seconds: Optional[int],
    clip_goal: Optional[str],
    template_id: Optional[str],
    browser: Optional[str],
) -> tuple[LinkBatchDownloadTask, Dict[str, Any]]:
    urls = parse_link_urls(urls_raw)
    validated = validate_link_urls(urls)

    if template_id:
        try:
            validate_template_id(template_id)
        except TemplateNotFoundError as exc:
            raise ValueError(str(exc)) from exc

    link_entries: List[tuple[str, str, str]] = []
    for url, platform in validated:
        title = await fetch_link_title(url, platform, browser)
        link_entries.append((url, platform, title))

    source_records = build_source_records_from_links(link_entries)

    project_settings: Dict[str, Any] = {
        "video_category": video_category or "knowledge",
        "clip_duration_preset": clip_duration_preset or "standard",
        "clip_goal": clip_goal or "knowledge",
        "download_status": "downloading",
        "download_progress": 0.0,
        "link_batch": {"urls": [entry[0] for entry in link_entries]},
    }
    if clip_min_seconds is not None:
        project_settings["clip_min_seconds"] = clip_min_seconds
    if clip_target_seconds is not None:
        project_settings["clip_target_seconds"] = clip_target_seconds
    if clip_max_seconds is not None:
        project_settings["clip_max_seconds"] = clip_max_seconds
    if template_id:
        project_settings["template_id"] = template_id
    project_settings = merge_template_settings(project_settings)

    db = SessionLocal()
    try:
        project_service = ProjectService(db)
        project_data = ProjectCreate(
            name=project_name.strip() or f"多链接项目 ({len(urls)} 个视频)",
            description=f"多链接项目: {len(urls)} 个视频",
            project_type=ProjectType.KNOWLEDGE,
            status=ProjectStatus.PENDING,
            source_url=validated[0][0],
            source_file=link_entries[0][2][:120],
            settings=project_settings,
        )
        project = project_service.create_project(project_data)
        project_id = str(project.id)

        resolved_sources = []
        for record in source_records:
            ensure_source_raw_dir(project_id, record.id)
            resolved_sources.append(assign_source_paths(project_id, record))

        raw_dir = get_project_raw_directory(project_id)
        raw_dir.mkdir(parents=True, exist_ok=True)

        processing_config = attach_multi_source_to_config(
            dict(project.processing_config or project_settings),
            resolved_sources,
        )
        project.processing_config = processing_config
        db.commit()

        task_id = str(uuid.uuid4())
        task = LinkBatchDownloadTask(
            id=task_id,
            project_id=project_id,
            project_name=project.name,
            total_urls=len(urls),
        )
        _link_batch_tasks[task_id] = task
        return task, {
            "browser": browser,
            "sources": [(s.id, s.source_url, s.platform) for s in resolved_sources],
        }
    finally:
        db.close()


def _update_task(task_id: str, **fields: Any) -> None:
    task = _link_batch_tasks.get(task_id)
    if task is None:
        return
    for key, value in fields.items():
        setattr(task, key, value)
    task.updated_at = datetime.now(timezone.utc).isoformat()


async def process_link_batch_download(
    task_id: str,
    *,
    browser: Optional[str],
    sources: List[tuple[str, str, Optional[str]]],
) -> None:
    task = _link_batch_tasks.get(task_id)
    if task is None:
        return

    project_id = task.project_id
    _update_task(task_id, status="processing", message="开始下载视频", progress=1.0)

    db = SessionLocal()
    try:
        project_service = ProjectService(db)
        project = project_service.get(project_id)
        if not project:
            raise RuntimeError("项目不存在")

        project_dir = get_project_directory(project_id)
        first_video_copied = False

        download_failures = 0

        for index, (source_id, url, platform_raw) in enumerate(sources):
            platform: LinkPlatform = "youtube" if platform_raw == "youtube" else "bilibili"
            base_progress = (index / len(sources)) * 85.0
            _update_task(
                task_id,
                current_url=url,
                message=f"正在下载 {index + 1}/{len(sources)}",
                progress=base_progress + 2.0,
                completed_urls=index,
            )

            video_dest = project_dir / "raw" / "sources" / source_id / "input.mp4"
            srt_dest = project_dir / "raw" / "sources" / source_id / "input.srt"
            try:
                await download_link_to_source(
                    url=url,
                    platform=platform,
                    video_dest=video_dest,
                    srt_dest=srt_dest,
                    browser=browser,
                )
            except Exception as exc:
                download_failures += 1
                logger.exception(
                    "多链接下载失败 source=%s url=%s: %s",
                    source_id,
                    url,
                    exc,
                )
                processing_config = mark_source_failed(
                    dict(project.processing_config or {}),
                    source_id,
                    str(exc),
                )
                project.processing_config = processing_config
                db.commit()
                continue

            if not first_video_copied:
                raw_dir = project_dir / "raw"
                shutil.copy2(video_dest, raw_dir / "input.mp4")
                shutil.copy2(srt_dest, raw_dir / "input.srt")
                project.video_path = str(raw_dir / "input.mp4")
                first_video_copied = True
            db.commit()

        processing_config = copy.deepcopy(project.processing_config or {})
        if download_failures == len(sources):
            processing_config["download_status"] = "failed"
            processing_config["download_message"] = "全部链接下载失败"
            project.status = ProjectStatus.FAILED
        elif download_failures > 0:
            processing_config["download_status"] = "partial"
            processing_config["download_message"] = f"{download_failures} 个链接下载失败，其余将继续处理"
        else:
            processing_config["download_status"] = "completed"
        processing_config["download_progress"] = 100.0
        project.processing_config = processing_config
        project.status = ProjectStatus.PENDING if download_failures < len(sources) else ProjectStatus.FAILED
        db.commit()

        if download_failures < len(sources):
            _update_task(
                task_id,
                status="completed",
                progress=100.0,
                message="下载完成，正在启动多源分析",
                completed_urls=len(sources) - download_failures,
                current_url=None,
            )
            submit_multi_source_project_task(project_id)
            logger.info("多链接项目 %s 下载完成（%d 失败），已提交多源流水线", project_id, download_failures)
        else:
            _update_task(
                task_id,
                status="failed",
                error_message=processing_config.get("download_message"),
                message="全部下载失败",
                progress=0.0,
            )
    except Exception as exc:
        logger.exception("多链接下载失败 project=%s: %s", project_id, exc)
        _update_task(
            task_id,
            status="failed",
            error_message=str(exc),
            message="下载失败",
            progress=0.0,
        )
        try:
            project = project_service.get(project_id)
            if project:
                project.status = ProjectStatus.FAILED
                cfg = dict(project.processing_config or {})
                cfg["error_message"] = str(exc)
                cfg["download_status"] = "failed"
                project.processing_config = cfg
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

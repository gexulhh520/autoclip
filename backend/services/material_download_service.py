"""素材库外部下载任务：排队、进度、入库。"""

from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

import yt_dlp

from backend.core.database import SessionLocal
from backend.core.path_utils import get_data_directory
from backend.models.material_library import (
    MaterialAssetOrigin,
    MaterialDownloadStatus,
    MaterialDownloadTask,
    MaterialFileStatus,
    MaterialLibraryAsset,
)
from backend.repositories.material_library_repository import (
    MaterialDownloadTaskRepository,
    MaterialLibraryRepository,
)
from backend.utils import ytdlp_core

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="material-dl")
_queue_lock = threading.Lock()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _library_root() -> Path:
    root = get_data_directory() / "material_library"
    (root / "videos").mkdir(parents=True, exist_ok=True)
    (root / "thumbs").mkdir(parents=True, exist_ok=True)
    (root / "downloads_temp").mkdir(parents=True, exist_ok=True)
    return root


def _task_to_dict(task: MaterialDownloadTask) -> Dict[str, Any]:
    return {
        "id": task.id,
        "status": task.status.value if task.status else None,
        "platform": task.platform,
        "external_id": task.external_id,
        "source_url": task.source_url,
        "title": task.title,
        "thumbnail_url": task.thumbnail_url,
        "duration_sec": task.duration_sec,
        "uploader": task.uploader,
        "search_query": task.search_query,
        "progress": task.progress,
        "error_message": task.error_message,
        "retry_count": task.retry_count,
        "asset_id": task.asset_id,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


def _download_thumbnail(thumb_url: Optional[str], dest: Path) -> Optional[str]:
    if not thumb_url:
        return None
    try:
        response = requests.get(thumb_url, timeout=20)
        response.raise_for_status()
        dest.write_bytes(response.content)
        return str(dest.relative_to(get_data_directory())).replace("\\", "/")
    except Exception as exc:
        logger.warning("缩略图下载失败 %s: %s", thumb_url, exc)
        return None


def create_download_tasks(
    items: List[dict],
    *,
    search_query: Optional[str] = None,
    browser: Optional[str] = None,
) -> List[dict]:
    if not items:
        raise ValueError("请选择至少一条素材")

    db = SessionLocal()
    created: List[MaterialDownloadTask] = []
    try:
        task_repo = MaterialDownloadTaskRepository(db)
        asset_repo = MaterialLibraryRepository(db)
        for raw in items:
            platform = str(raw.get("platform") or "").strip().lower()
            source_url = str(raw.get("url") or raw.get("source_url") or "").strip()
            title = str(raw.get("title") or source_url or "未命名")[:255]
            if not platform or not source_url:
                continue

            external_id = raw.get("external_id")
            if external_id:
                existing = asset_repo.find_ready_by_platform_external(platform, str(external_id))
                if existing:
                    continue

            active = task_repo.find_active_by_source(platform, source_url)
            if active:
                created.append(active)
                continue

            task = task_repo.create(
                auto_commit=False,
                id=f"mdl-{uuid.uuid4().hex[:12]}",
                status=MaterialDownloadStatus.PENDING,
                platform=platform,
                external_id=str(external_id) if external_id else None,
                source_url=source_url,
                title=title,
                thumbnail_url=raw.get("thumbnail") or raw.get("thumbnail_url"),
                duration_sec=raw.get("duration_sec"),
                uploader=raw.get("uploader"),
                search_query=search_query,
                progress=0.0,
                task_metadata={"browser": browser} if browser else None,
            )
            created.append(task)
        db.commit()
        for task in created:
            db.refresh(task)
            if task.status == MaterialDownloadStatus.PENDING:
                _enqueue_download(task.id)
        return [_task_to_dict(task) for task in created]
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def list_download_tasks(
    status: Optional[str] = None,
    limit: int = 100,
) -> List[dict]:
    db = SessionLocal()
    try:
        repo = MaterialDownloadTaskRepository(db)
        parsed_status = None
        if status:
            try:
                parsed_status = MaterialDownloadStatus(status)
            except ValueError:
                pass
        tasks = repo.list_tasks(status=parsed_status, limit=limit)
        return [_task_to_dict(task) for task in tasks]
    finally:
        db.close()


def get_download_task(task_id: str) -> Optional[dict]:
    db = SessionLocal()
    try:
        repo = MaterialDownloadTaskRepository(db)
        task = repo.get_by_id(task_id)
        return _task_to_dict(task) if task else None
    finally:
        db.close()


def count_active_downloads() -> int:
    db = SessionLocal()
    try:
        return MaterialDownloadTaskRepository(db).count_active()
    finally:
        db.close()


def retry_download_task(task_id: str) -> dict:
    db = SessionLocal()
    try:
        repo = MaterialDownloadTaskRepository(db)
        task = repo.get_by_id(task_id)
        if task is None:
            raise ValueError(f"下载任务不存在: {task_id}")
        if task.status not in (MaterialDownloadStatus.FAILED, MaterialDownloadStatus.CANCELLED):
            raise ValueError("仅失败或已取消的任务可重试")
        task.status = MaterialDownloadStatus.PENDING
        task.progress = 0.0
        task.error_message = None
        task.retry_count = (task.retry_count or 0) + 1
        task.started_at = None
        task.completed_at = None
        task.asset_id = None
        db.commit()
        db.refresh(task)
        _enqueue_download(task.id)
        return _task_to_dict(task)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def delete_download_task(task_id: str) -> None:
    db = SessionLocal()
    try:
        repo = MaterialDownloadTaskRepository(db)
        task = repo.get_by_id(task_id)
        if task is None:
            raise ValueError(f"下载任务不存在: {task_id}")
        if task.status == MaterialDownloadStatus.DOWNLOADING:
            raise ValueError("下载进行中，请先取消")
        repo.delete(task_id)
    finally:
        db.close()


def cancel_download_task(task_id: str) -> dict:
    db = SessionLocal()
    try:
        repo = MaterialDownloadTaskRepository(db)
        task = repo.get_by_id(task_id)
        if task is None:
            raise ValueError(f"下载任务不存在: {task_id}")
        if task.status not in (
            MaterialDownloadStatus.PENDING,
            MaterialDownloadStatus.DOWNLOADING,
        ):
            raise ValueError("任务已结束，无法取消")
        task.status = MaterialDownloadStatus.CANCELLED
        task.completed_at = _utc_now()
        db.commit()
        db.refresh(task)
        return _task_to_dict(task)
    finally:
        db.close()


def _enqueue_download(task_id: str) -> None:
    with _queue_lock:
        _executor.submit(_run_download_task, task_id)


def _update_task(task_id: str, **fields: Any) -> None:
    db = SessionLocal()
    try:
        repo = MaterialDownloadTaskRepository(db)
        task = repo.get_by_id(task_id)
        if task is None:
            return
        for key, value in fields.items():
            if hasattr(task, key):
                setattr(task, key, value)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("更新下载任务失败: %s", task_id)
    finally:
        db.close()


def _run_download_task(task_id: str) -> None:
    db = SessionLocal()
    try:
        task_repo = MaterialDownloadTaskRepository(db)
        task = task_repo.get_by_id(task_id)
        if task is None or task.status != MaterialDownloadStatus.PENDING:
            return
        task.status = MaterialDownloadStatus.DOWNLOADING
        task.started_at = _utc_now()
        task.progress = 0.0
        source_url = task.source_url
        platform = task.platform
        title = task.title
        external_id = task.external_id
        search_query = task.search_query
        thumbnail_url = task.thumbnail_url
        duration_sec = task.duration_sec
        uploader = task.uploader
        browser = None
        if isinstance(task.task_metadata, dict):
            browser = task.task_metadata.get("browser")
        db.commit()
    finally:
        db.close()

    temp_dir = _library_root() / "downloads_temp" / task_id
    temp_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(temp_dir / "%(id)s.%(ext)s")

    def progress_hook(data: dict) -> None:
        if data.get("status") != "downloading":
            return
        total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
        downloaded = data.get("downloaded_bytes") or 0
        if total:
            progress = min(99.0, downloaded * 100.0 / total)
            _update_task(task_id, progress=progress)

    ydl_opts = ytdlp_core.base_ytdl_opts(
        format="bestvideo+bestaudio/best",
        merge_output_format="mp4",
        outtmpl=output_template,
        progress_hooks=[progress_hook],
    )
    if platform == "youtube":
        ydl_opts = ytdlp_core.apply_youtube_client(ydl_opts)

    try:
        def _download(run_opts: dict, use_browser: bool):
            run_opts = dict(run_opts)
            if use_browser and browser:
                run_opts["cookiesfrombrowser"] = (browser.lower(),)
            else:
                run_opts.pop("cookiesfrombrowser", None)
            with ytdlp_core.sanitized_yt_env():
                with yt_dlp.YoutubeDL(run_opts) as ydl:
                    return ydl.extract_info(source_url, download=True)

        info = ytdlp_core.run_ytdl_with_fallbacks(ydl_opts, browser, "下载", _download)
        if not info:
            raise RuntimeError("未获取到下载信息")

        downloaded_files = sorted(temp_dir.glob("*"))
        video_file = next((p for p in downloaded_files if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}), None)
        if video_file is None and info.get("requested_downloads"):
            for item in info["requested_downloads"]:
                fp = item.get("filepath")
                if fp and Path(fp).exists():
                    video_file = Path(fp)
                    break
        if video_file is None:
            raise RuntimeError("下载完成但未找到视频文件")

        asset_id = f"lib-{uuid.uuid4().hex[:12]}"
        dest_rel = f"material_library/videos/{asset_id}.mp4"
        dest_path = get_data_directory() / dest_rel
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if video_file.resolve() != dest_path.resolve():
            video_file.replace(dest_path)

        thumb_rel = _download_thumbnail(
            thumbnail_url or info.get("thumbnail"),
            _library_root() / "thumbs" / f"{asset_id}.jpg",
        )
        file_size = dest_path.stat().st_size if dest_path.exists() else None
        if duration_sec is None and info.get("duration"):
            try:
                duration_sec = int(info["duration"])
            except (TypeError, ValueError):
                duration_sec = None
        if not external_id:
            external_id = info.get("id")

        db = SessionLocal()
        try:
            asset_repo = MaterialLibraryRepository(db)
            if external_id:
                existing = asset_repo.find_ready_by_platform_external(platform, str(external_id))
                if existing:
                    _update_task(
                        task_id,
                        status=MaterialDownloadStatus.COMPLETED,
                        progress=100.0,
                        asset_id=existing.id,
                        completed_at=_utc_now(),
                        error_message=None,
                    )
                    if dest_path.exists():
                        dest_path.unlink()
                    return

            asset = asset_repo.create(
                auto_commit=False,
                id=asset_id,
                title=str(info.get("title") or title)[:255],
                origin=MaterialAssetOrigin.EXTERNAL_DOWNLOAD,
                platform=platform,
                external_id=str(external_id) if external_id else None,
                source_url=str(info.get("webpage_url") or source_url),
                video_path=dest_rel,
                thumbnail_path=thumb_rel,
                duration_sec=duration_sec,
                file_size_bytes=file_size,
                uploader=str(info.get("uploader") or uploader or "")[:255] or None,
                upload_date=info.get("upload_date"),
                view_count=info.get("view_count"),
                search_query=search_query,
                downloaded_at=_utc_now(),
                file_status=MaterialFileStatus.READY,
                asset_metadata={
                    "description": info.get("description"),
                },
            )
            task_repo = MaterialDownloadTaskRepository(db)
            task = task_repo.get_by_id(task_id)
            if task is None or task.status == MaterialDownloadStatus.CANCELLED:
                db.rollback()
                return
            task.status = MaterialDownloadStatus.COMPLETED
            task.progress = 100.0
            task.asset_id = asset.id
            task.completed_at = _utc_now()
            task.error_message = None
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    except Exception as exc:
        logger.exception("素材下载失败 %s: %s", task_id, exc)
        _update_task(
            task_id,
            status=MaterialDownloadStatus.FAILED,
            error_message=str(exc),
            completed_at=_utc_now(),
        )
    finally:
        if temp_dir.exists():
            for path in temp_dir.glob("*"):
                try:
                    path.unlink()
                except OSError:
                    pass
            try:
                temp_dir.rmdir()
            except OSError:
                pass

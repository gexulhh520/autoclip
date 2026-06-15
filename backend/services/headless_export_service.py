"""Headless Compositor 导出任务队列（磁盘 plan.json + 内存 job 同步）。"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.path_utils import get_projects_directory

logger = logging.getLogger(__name__)


@dataclass
class HeadlessExportJobItem:
    job_id: str
    project_id: str
    session_id: str
    filename: str
    burn_subtitles: bool
    export_srt: bool
    use_source_video: Optional[bool]
    output_dir: Optional[str]
    plan_path: str
    status: str = "pending"


def _plan_files() -> List[Path]:
    projects_dir = get_projects_directory()
    if not projects_dir.is_dir():
        return []
    files: List[Path] = []
    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir():
            continue
        headless_root = project_dir / "edit_sessions"
        if not headless_root.is_dir():
            continue
        for session_dir in headless_root.iterdir():
            if not session_dir.is_dir():
                continue
            headless_dir = session_dir / "headless"
            if not headless_dir.is_dir():
                continue
            files.extend(sorted(headless_dir.glob("*.plan.json")))
    return files


def _read_plan(path: Path) -> Optional[Dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("读取 headless plan 失败 %s: %s", path, exc)
        return None
    return raw if isinstance(raw, dict) else None


def _write_plan(path: Path, payload: Dict[str, Any]) -> None:
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _item_from_plan(path: Path, payload: Dict[str, Any]) -> Optional[HeadlessExportJobItem]:
    job_id = str(payload.get("job_id") or path.stem.replace(".plan", ""))
    project_id = str(payload.get("project_id") or "")
    session_id = str(payload.get("session_id") or "")
    if not project_id or not session_id:
        return None
    try:
        project_dir = get_projects_directory() / project_id
        rel = path.relative_to(project_dir).as_posix()
    except ValueError:
        rel = path.as_posix()
    return HeadlessExportJobItem(
        job_id=job_id,
        project_id=project_id,
        session_id=session_id,
        filename=str(payload.get("filename") or "export"),
        burn_subtitles=bool(payload.get("burn_subtitles", True)),
        export_srt=bool(payload.get("export_srt", False)),
        use_source_video=payload.get("use_source_video"),
        output_dir=payload.get("output_dir"),
        plan_path=rel,
        status=str(payload.get("status") or "pending"),
    )


def list_pending_headless_jobs(limit: int = 20) -> List[HeadlessExportJobItem]:
    pending: List[HeadlessExportJobItem] = []
    for path in _plan_files():
        payload = _read_plan(path)
        if not payload:
            continue
        status = str(payload.get("status") or "pending")
        if status != "pending":
            continue
        item = _item_from_plan(path, payload)
        if item:
            pending.append(item)
        if len(pending) >= limit:
            break
    return pending


def _resolve_plan_path(project_id: str, session_id: str, job_id: str) -> Path:
    return (
        get_projects_directory()
        / project_id
        / "edit_sessions"
        / session_id
        / "headless"
        / f"{job_id}.plan.json"
    )


def claim_headless_job(project_id: str, session_id: str, job_id: str) -> HeadlessExportJobItem:
    path = _resolve_plan_path(project_id, session_id, job_id)
    if not path.is_file():
        raise FileNotFoundError(job_id)
    payload = _read_plan(path)
    if not payload:
        raise ValueError("invalid plan")
    status = str(payload.get("status") or "pending")
    if status not in {"pending", "running"}:
        raise ValueError(f"job not claimable: {status}")
    payload["status"] = "running"
    payload["message"] = "Compositor 工作进程处理中"
    _write_plan(path, payload)
    _sync_memory_job(job_id, status="running", progress=1, message="Compositor 工作进程处理中")
    item = _item_from_plan(path, payload)
    if not item:
        raise ValueError("invalid plan item")
    return item


def update_headless_job_progress(
    project_id: str,
    session_id: str,
    job_id: str,
    *,
    progress: int,
    message: str,
) -> None:
    path = _resolve_plan_path(project_id, session_id, job_id)
    payload = _read_plan(path)
    if not payload:
        raise FileNotFoundError(job_id)
    payload["progress"] = max(0, min(100, int(progress)))
    payload["message"] = message
    _write_plan(path, payload)
    _sync_memory_job(job_id, status="running", progress=progress, message=message)


def complete_headless_job(
    project_id: str,
    session_id: str,
    job_id: str,
    *,
    output_path: str,
    download_url: str,
    local_output_path: Optional[str] = None,
    srt_path: Optional[str] = None,
    srt_download_url: Optional[str] = None,
    local_srt_path: Optional[str] = None,
) -> None:
    path = _resolve_plan_path(project_id, session_id, job_id)
    payload = _read_plan(path)
    if not payload:
        raise FileNotFoundError(job_id)
    payload["status"] = "completed"
    payload["progress"] = 100
    payload["message"] = "Headless 导出完成"
    payload["result"] = {
        "output_path": output_path,
        "download_url": download_url,
        "local_output_path": local_output_path,
        "srt_path": srt_path,
        "srt_download_url": srt_download_url,
        "local_srt_path": local_srt_path,
    }
    _write_plan(path, payload)
    _sync_memory_job(
        job_id,
        status="completed",
        progress=100,
        message="Headless 导出完成",
        output_path=output_path,
        download_url=download_url,
        local_output_path=local_output_path,
        srt_path=srt_path,
        srt_download_url=srt_download_url,
        local_srt_path=local_srt_path,
    )


def fail_headless_job(
    project_id: str,
    session_id: str,
    job_id: str,
    *,
    error: str,
) -> None:
    path = _resolve_plan_path(project_id, session_id, job_id)
    payload = _read_plan(path)
    if not payload:
        raise FileNotFoundError(job_id)
    payload["status"] = "failed"
    payload["progress"] = 0
    payload["message"] = "Headless 导出失败"
    payload["error"] = error
    _write_plan(path, payload)
    _sync_memory_job(
        job_id,
        status="failed",
        progress=0,
        message="Headless 导出失败",
        error=error,
    )


def _sync_memory_job(job_id: str, **fields: Any) -> None:
    try:
        from backend.services.edit_export_job_service import edit_export_job_service

        edit_export_job_service.get_job(job_id)
        edit_export_job_service._update(job_id, **fields)
    except KeyError:
        pass
    except Exception as exc:
        logger.debug("sync memory headless job skipped: %s", exc)

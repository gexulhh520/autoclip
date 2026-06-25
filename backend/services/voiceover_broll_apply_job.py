"""口播 B-roll 应用异步任务与进度（内存态，单进程）。"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

_LOCK = threading.Lock()
_JOBS: Dict[str, "BrollApplyJobState"] = {}
_MAX_JOBS = 200


@dataclass
class BrollApplyJobState:
    operation_id: str
    project_id: str
    session_id: str
    segment_id: str
    stage: str = "starting"
    progress: float = 0.0
    message: str = "准备应用 B-roll…"
    download_task_id: Optional[str] = None
    download_progress: Optional[float] = None
    done: bool = False
    failed: bool = False
    error: Optional[str] = None
    note: Optional[str] = None
    session: Any = None
    plan: Any = None


def _segment_job_key(project_id: str, session_id: str, segment_id: str) -> str:
    return f"{project_id}:{session_id}:{segment_id}"


def find_active_segment_job(
    project_id: str, session_id: str, segment_id: str
) -> Optional[BrollApplyJobState]:
    key = _segment_job_key(project_id, session_id, segment_id)
    with _LOCK:
        for job in _JOBS.values():
            if not job.done and _segment_job_key(job.project_id, job.session_id, job.segment_id) == key:
                return job
    return None


def create_broll_apply_job(project_id: str, session_id: str, segment_id: str) -> BrollApplyJobState:
    existing = find_active_segment_job(project_id, session_id, segment_id)
    if existing is not None:
        return existing

    operation_id = str(uuid.uuid4())
    job = BrollApplyJobState(
        operation_id=operation_id,
        project_id=project_id,
        session_id=session_id,
        segment_id=segment_id,
    )
    with _LOCK:
        if len(_JOBS) >= _MAX_JOBS:
            oldest = next(iter(_JOBS))
            _JOBS.pop(oldest, None)
        _JOBS[operation_id] = job
    return job


def update_broll_apply_job(operation_id: str, **fields: Any) -> Optional[BrollApplyJobState]:
    with _LOCK:
        job = _JOBS.get(operation_id)
        if job is None:
            return None
        for key, value in fields.items():
            if hasattr(job, key):
                setattr(job, key, value)
        return job


def get_broll_apply_job(operation_id: str) -> Optional[BrollApplyJobState]:
    with _LOCK:
        return _JOBS.get(operation_id)

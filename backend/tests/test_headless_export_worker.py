"""Headless worker 队列服务测试。"""
import json
from pathlib import Path

from backend.services.headless_export_service import (
    claim_headless_job,
    complete_headless_job,
    list_pending_headless_jobs,
)


def _write_plan(project_dir: Path, project_id: str, session_id: str, job_id: str) -> Path:
    headless_dir = project_dir / "edit_sessions" / session_id / "headless"
    headless_dir.mkdir(parents=True, exist_ok=True)
    path = headless_dir / f"{job_id}.plan.json"
    payload = {
        "job_id": job_id,
        "project_id": project_id,
        "session_id": session_id,
        "filename": "demo",
        "burn_subtitles": True,
        "export_srt": False,
        "use_source_video": False,
        "output_dir": None,
        "status": "pending",
        "progress": 0,
        "message": "等待 Compositor 工作进程",
        "plan": {"schema_version": "export-scene-1"},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def test_headless_queue_claim_and_complete(tmp_path, monkeypatch):
    project_id = "p-headless-worker"
    session_id = "s-headless-worker"
    job_id = "job-123"
    project_dir = tmp_path / "projects" / project_id
    _write_plan(project_dir, project_id, session_id, job_id)

    monkeypatch.setattr(
        "backend.services.headless_export_service.get_projects_directory",
        lambda: tmp_path / "projects",
    )

    pending = list_pending_headless_jobs()
    assert len(pending) == 1
    assert pending[0].job_id == job_id

    claimed = claim_headless_job(project_id, session_id, job_id)
    assert claimed.status == "running"

    complete_headless_job(
        project_id,
        session_id,
        job_id,
        output_path="edit_exports/out.mp4",
        download_url="/api/v1/download/out.mp4",
        local_output_path="C:/exports/out.mp4",
    )

    plan_path = project_dir / "edit_sessions" / session_id / "headless" / f"{job_id}.plan.json"
    saved = json.loads(plan_path.read_text(encoding="utf-8"))
    assert saved["status"] == "completed"
    assert saved["result"]["local_output_path"] == "C:/exports/out.mp4"

    assert list_pending_headless_jobs() == []

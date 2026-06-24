"""Headless Compositor 导出 API 冒烟。"""
import json
from pathlib import Path

from backend.services.edit_export_job_service import EditExportJobService
from backend.services.edit_session_service import EditSessionService


def _write_project_clips(project_dir: Path) -> None:
    metadata_dir = project_dir / "metadata"
    clips_dir = project_dir / "output" / "clips"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    (clips_dir / "1_clip.mp4").write_bytes(b"fake")

    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "测试",
                    "content": ["测试字幕"],
                    "recommend_reason": "",
                    "generated_title": "clip-1",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                }
            ]
        ),
        encoding="utf-8",
    )


def test_get_compositor_plan_and_headless_job(tmp_path, monkeypatch):
    project_id = "headless-export"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.core.path_utils.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1"])
    session, _ = service.append_blocks(project_id, session.id, ["1"])

    from backend.pipeline.scene_builder import compile_export_plan, serialize_export_plan

    plan = compile_export_plan(session, burn_subtitles=True)
    payload = serialize_export_plan(plan)
    assert payload["schema_version"] == "export-scene-1"
    assert payload["canvas"]["width"] > 0

    job_service = EditExportJobService()
    job = job_service.start_headless_compositor_export(
        project_id=project_id,
        session_id=session.id,
        session_payload=session.model_dump(),
        burn_subtitles=True,
        export_srt=False,
        use_source_video=False,
        output_dir=None,
        filename="headless-test",
    )
    assert job.job_type == "headless_compositor"
    assert job.status == "pending"
    assert job.output_path is not None

    plan_file = project_dir / job.output_path
    assert plan_file.is_file()
    saved = json.loads(plan_file.read_text(encoding="utf-8"))
    assert saved["job_id"] == job.id
    assert saved["plan"]["session_id"] == session.id

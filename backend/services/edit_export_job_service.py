"""剪辑导出异步任务（内存 job 队列）。"""
from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int, str], None]


@dataclass
class EditExportBatchFile:
    block_id: str
    title: str
    output_path: str
    download_url: str
    srt_path: Optional[str] = None
    srt_download_url: Optional[str] = None
    local_output_path: Optional[str] = None
    local_srt_path: Optional[str] = None


@dataclass
class EditExportJob:
    id: str
    project_id: str
    session_id: str
    job_type: str = "single"
    status: str = "pending"
    progress: int = 0
    message: str = "排队中"
    download_url: Optional[str] = None
    srt_download_url: Optional[str] = None
    output_path: Optional[str] = None
    srt_path: Optional[str] = None
    project_clip_path: Optional[str] = None
    local_output_path: Optional[str] = None
    local_srt_path: Optional[str] = None
    batch_files: List[EditExportBatchFile] = field(default_factory=list)
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EditExportJobService:
    def __init__(self) -> None:
        self._jobs: Dict[str, EditExportJob] = {}
        self._lock = threading.Lock()

    def get_job(self, job_id: str) -> EditExportJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            return job

    def _update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in fields.items():
                setattr(job, key, value)
            job.updated_at = datetime.now(timezone.utc).isoformat()

    def start_export(
        self,
        *,
        project_id: str,
        session_id: str,
        session_payload: dict,
        burn_subtitles: bool,
        output_filename: Optional[str],
        export_srt: bool,
        use_source_video: Optional[bool],
        write_back_to_project: bool = False,
        output_dir: Optional[str] = None,
    ) -> EditExportJob:
        job_id = str(uuid.uuid4())
        job = EditExportJob(
            id=job_id,
            project_id=project_id,
            session_id=session_id,
            job_type="single",
        )
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(
            target=self._run_export,
            args=(
                job_id,
                session_payload,
                burn_subtitles,
                output_filename,
                export_srt,
                use_source_video,
                write_back_to_project,
                output_dir,
            ),
            daemon=True,
        )
        thread.start()
        return job

    def start_batch_export(
        self,
        *,
        project_id: str,
        session_id: str,
        session_payload: dict,
        burn_subtitles: bool,
        export_srt: bool,
        use_source_video: Optional[bool],
        output_dir: Optional[str] = None,
    ) -> EditExportJob:
        job_id = str(uuid.uuid4())
        job = EditExportJob(
            id=job_id,
            project_id=project_id,
            session_id=session_id,
            job_type="batch",
        )
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(
            target=self._run_batch_export,
            args=(
                job_id,
                session_payload,
                burn_subtitles,
                export_srt,
                use_source_video,
                output_dir,
            ),
            daemon=True,
        )
        thread.start()
        return job

    def _run_export(
        self,
        job_id: str,
        session_payload: dict,
        burn_subtitles: bool,
        output_filename: Optional[str],
        export_srt: bool,
        use_source_video: Optional[bool],
        write_back_to_project: bool = False,
        output_dir: Optional[str] = None,
    ) -> None:
        from backend.core.path_utils import get_project_directory
        from backend.pipeline.edit_renderer import export_edit_session
        from backend.schemas.edit_session import EditSession
        from backend.services.edit_session_service import EditSessionService
        from backend.utils.export_local import copy_export_outputs

        def on_progress(progress: int, message: str) -> None:
            self._update(job_id, status="running", progress=progress, message=message)

        try:
            self._update(job_id, status="running", progress=1, message="准备导出")
            session = EditSession.model_validate(session_payload)
            output_path, srt_path = export_edit_session(
                session,
                burn_subtitles=burn_subtitles,
                output_filename=output_filename,
                export_srt=export_srt,
                use_source_video=use_source_video,
                progress_callback=on_progress,
            )
            project_clip_path: Optional[str] = None
            if write_back_to_project:
                on_progress(98, "回写项目切片")
                service = EditSessionService()
                project_clip_path = service.write_export_to_project(
                    session.project_id,
                    session,
                    output_path,
                    title=output_filename or session.name,
                )

            project_dir = get_project_directory(session.project_id)
            rel = output_path.relative_to(project_dir).as_posix()
            srt_rel: Optional[str] = None
            srt_download_url: Optional[str] = None
            if srt_path is not None:
                srt_rel = srt_path.relative_to(project_dir).as_posix()
                srt_download_url = (
                    f"/api/v1/projects/{session.project_id}/edit-sessions/"
                    f"{session.id}/exports/{srt_path.name}"
                )

            on_progress(99, "保存到本地目录")
            local_video, local_srt = copy_export_outputs(output_path, srt_path, output_dir)

            self._update(
                job_id,
                status="completed",
                progress=100,
                message="导出完成",
                output_path=rel,
                project_clip_path=project_clip_path,
                download_url=(
                    f"/api/v1/projects/{session.project_id}/edit-sessions/"
                    f"{session.id}/exports/{output_path.name}"
                ),
                srt_path=srt_rel,
                srt_download_url=srt_download_url,
                local_output_path=str(local_video),
                local_srt_path=str(local_srt) if local_srt else None,
            )
        except Exception as exc:
            logger.exception("异步导出失败: %s", job_id)
            self._update(
                job_id,
                status="failed",
                progress=0,
                message="导出失败",
                error=str(exc),
            )

    def _run_batch_export(
        self,
        job_id: str,
        session_payload: dict,
        burn_subtitles: bool,
        export_srt: bool,
        use_source_video: Optional[bool],
        output_dir: Optional[str] = None,
    ) -> None:
        from backend.core.path_utils import get_project_directory
        from backend.pipeline.edit_renderer import batch_export_edit_session
        from backend.schemas.edit_session import EditSession
        from backend.utils.export_local import copy_export_outputs

        def on_progress(progress: int, message: str) -> None:
            self._update(job_id, status="running", progress=progress, message=message)

        try:
            self._update(job_id, status="running", progress=1, message="准备批量导出")
            session = EditSession.model_validate(session_payload)
            exports = batch_export_edit_session(
                session,
                burn_subtitles=burn_subtitles,
                export_srt=export_srt,
                use_source_video=use_source_video,
                progress_callback=on_progress,
            )
            project_dir = get_project_directory(session.project_id)
            batch_files: List[EditExportBatchFile] = []
            for block, video_path, srt_path in exports:
                rel = video_path.relative_to(project_dir).as_posix()
                item = EditExportBatchFile(
                    block_id=block.id,
                    title=block.title,
                    output_path=rel,
                    download_url=(
                        f"/api/v1/projects/{session.project_id}/edit-sessions/"
                        f"{session.id}/exports/{video_path.name}"
                    ),
                )
                if srt_path is not None:
                    item.srt_path = srt_path.relative_to(project_dir).as_posix()
                    item.srt_download_url = (
                        f"/api/v1/projects/{session.project_id}/edit-sessions/"
                        f"{session.id}/exports/{srt_path.name}"
                    )
                local_video, local_srt = copy_export_outputs(video_path, srt_path, output_dir)
                item.local_output_path = str(local_video)
                item.local_srt_path = str(local_srt) if local_srt else None
                batch_files.append(item)

            self._update(
                job_id,
                status="completed",
                progress=100,
                message=f"批量导出完成（{len(batch_files)} 个文件）",
                batch_files=batch_files,
            )
        except Exception as exc:
            logger.exception("异步批量导出失败: %s", job_id)
            self._update(
                job_id,
                status="failed",
                progress=0,
                message="批量导出失败",
                error=str(exc),
            )


edit_export_job_service = EditExportJobService()

"""剪辑工程 API。"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.schemas.edit_session import (
    EditSessionCreateRequest,
    EditSessionCreateResponse,
    EditSessionBlankCreateResponse,
    EditSessionAppendRequest,
    EditSessionAppendResponse,
    EditSessionBatchExportRequest,
    EditSessionBatchExportResponse,
    EditSessionBatchExportItem,
    EditSessionBilibiliUploadRequest,
    EditSessionBilibiliUploadResponse,
    EditSessionExportRequest,
    EditSessionCompositorMuxRequest,
    EditSessionCompositorPlanResponse,
    EditSessionHeadlessExportRequest,
    EditSessionExportJobStatusResponse,
    EditSessionExportResponse,
    EditSessionImportMediaResponse,
    EditSessionImportBgmUrlRequest,
    EditSessionListResponse,
    EditSessionPreviewOverlayRequest,
    EditSessionRegenerateRequest,
    EditSessionRegenerateResponse,
    EditSessionSilenceDetectRequest,
    EditSessionSilenceDetectResponse,
    EditSessionSilenceRegion,
    EditSessionUpdateRequest,
)
from backend.schemas.editor_agent import (
    AnalyzeLayoutRequest,
    AnalyzeLayoutResponse,
    AnalyzeSubtitleFrameRequest,
    AnalyzeSubtitleFrameResponse,
    AgentChatRequest,
    AgentChatResponse,
)
from backend.services.edit_session_service import EditSessionService
from backend.services.editor_agent_service import EditorAgentService

logger = logging.getLogger(__name__)

router = APIRouter()


def get_edit_session_service(db: Session = Depends(get_db)) -> EditSessionService:
    return EditSessionService(db=db)


@router.get("/{project_id}/edit-sessions", response_model=EditSessionListResponse)
async def list_edit_sessions(
    project_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        return EditSessionListResponse(sessions=service.list_sessions(project_id))
    except Exception as exc:
        logger.exception("列出剪辑工程失败: %s", project_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions", response_model=EditSessionCreateResponse)
async def create_edit_session(
    project_id: str,
    body: EditSessionCreateRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        session = service.create_session(
            project_id,
            body.clip_ids,
            name=body.name,
            source_id=body.source_id,
        )
        return EditSessionCreateResponse(session=session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("创建剪辑工程失败: %s", project_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/blank",
    response_model=EditSessionBlankCreateResponse,
)
async def create_blank_edit_session(
    project_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        session = service.create_blank_session(project_id)
        return EditSessionBlankCreateResponse(session=session)
    except Exception as exc:
        logger.exception("创建空白剪辑工程失败: %s", project_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/append-clips",
    response_model=EditSessionAppendResponse,
)
async def append_edit_session_clips(
    project_id: str,
    session_id: str,
    body: EditSessionAppendRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        session, added = service.append_blocks(
            project_id,
            session_id,
            body.clip_ids,
            source_id=body.source_id,
            insert_index=body.insert_index,
        )
        return EditSessionAppendResponse(session=session, added_count=added)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("追加剪辑片段失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/edit-sessions/{session_id}")
async def get_edit_session(
    project_id: str,
    session_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        return service.get_session(project_id, session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc


@router.patch("/{project_id}/edit-sessions/{session_id}")
async def update_edit_session(
    project_id: str,
    session_id: str,
    body: EditSessionUpdateRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        return service.update_session(project_id, session_id, body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except Exception as exc:
        logger.exception("更新剪辑工程失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/edit-sessions/{session_id}")
async def delete_edit_session(
    project_id: str,
    session_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        service.delete_session(project_id, session_id)
        return {"success": True}
    except Exception as exc:
        logger.exception("删除剪辑工程失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/preview-overlay")
async def preview_edit_session_overlay(
    project_id: str,
    session_id: str,
    body: EditSessionPreviewOverlayRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.pipeline.edit_renderer import preview_block_overlay

    try:
        session = service.get_session(project_id, session_id)
        return preview_block_overlay(session, body.block_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/detect-silence",
    response_model=EditSessionSilenceDetectResponse,
)
async def detect_edit_session_silence(
    project_id: str,
    session_id: str,
    body: EditSessionSilenceDetectRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.core.path_utils import get_project_directory
    from backend.pipeline.edit_renderer import detect_block_silence

    try:
        session = service.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == body.block_id), None)
        if block is None:
            raise HTTPException(status_code=404, detail="片段不存在")
        result = detect_block_silence(
            get_project_directory(project_id),
            block,
            noise_db=body.noise_db,
            min_silence_sec=body.min_silence_sec,
        )
        suggested = result["suggested_trim"]
        return EditSessionSilenceDetectResponse(
            success=True,
            silence_regions=[
                EditSessionSilenceRegion(**region) for region in result["silence_regions"]
            ],
            suggested_trim=result["suggested_trim"],
            removed_sec=float(result["removed_sec"]),
            split_points=[float(item) for item in result.get("split_points", [])],
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("静音检测失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/regenerate-content", response_model=EditSessionRegenerateResponse)
async def regenerate_edit_session_content(
    project_id: str,
    session_id: str,
    body: EditSessionRegenerateRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        session = service.regenerate_block_content(
            project_id,
            session_id,
            body.block_id,
            mode=body.mode,
        )
        block = next((item for item in session.sequence if item.id == body.block_id), None)
        if block is None:
            raise HTTPException(status_code=404, detail="片段不存在")
        return EditSessionRegenerateResponse(
            success=True,
            outline=block.overlay.outline,
            content=block.overlay.content,
            mode=body.mode,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("重写剪辑文案失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/batch-export", response_model=EditSessionBatchExportResponse)
async def batch_export_edit_session_video(
    project_id: str,
    session_id: str,
    body: EditSessionBatchExportRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.core.path_utils import get_project_directory
    from backend.pipeline.edit_renderer import batch_export_edit_session as run_batch_export
    from backend.services.edit_export_job_service import edit_export_job_service

    try:
        session = service.get_session(project_id, session_id)
        if body.async_export:
            job = edit_export_job_service.start_batch_export(
                project_id=project_id,
                session_id=session_id,
                session_payload=session.model_dump(),
                burn_subtitles=body.burn_subtitles,
                export_srt=body.export_srt,
                use_source_video=body.use_source_video,
                output_dir=body.output_dir,
            )
            return EditSessionBatchExportResponse(success=True, files=[], job_id=job.id)

        from backend.utils.export_local import copy_export_outputs

        project_dir = get_project_directory(project_id)
        exports = run_batch_export(
            session,
            burn_subtitles=body.burn_subtitles,
            export_srt=body.export_srt,
            use_source_video=body.use_source_video,
        )
        files: list[EditSessionBatchExportItem] = []
        for block, video_path, srt_path in exports:
            rel = video_path.relative_to(project_dir).as_posix()
            item = EditSessionBatchExportItem(
                block_id=block.id,
                title=block.title,
                output_path=rel,
                download_url=f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/exports/{video_path.name}",
            )
            if srt_path is not None:
                item.srt_path = srt_path.relative_to(project_dir).as_posix()
                item.srt_download_url = (
                    f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/exports/{srt_path.name}"
                )
            local_video, local_srt = copy_export_outputs(video_path, srt_path, body.output_dir)
            item.local_output_path = str(local_video)
            item.local_srt_path = str(local_srt) if local_srt else None
            files.append(item)
        return EditSessionBatchExportResponse(success=True, files=files)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("批量导出剪辑工程失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/export", response_model=EditSessionExportResponse)
async def export_edit_session_video(
    project_id: str,
    session_id: str,
    body: EditSessionExportRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.core.path_utils import get_project_directory
    from backend.pipeline.edit_renderer import export_edit_session as run_export
    from backend.services.edit_export_job_service import edit_export_job_service

    try:
        session = service.get_session(project_id, session_id)
        if body.async_export:
            job = edit_export_job_service.start_export(
                project_id=project_id,
                session_id=session_id,
                session_payload=session.model_dump(),
                burn_subtitles=body.burn_subtitles,
                output_filename=body.filename or session.name,
                export_srt=body.export_srt,
                use_source_video=body.use_source_video,
                write_back_to_project=body.write_back_to_project,
                output_dir=body.output_dir,
            )
            return EditSessionExportResponse(
                success=True,
                output_path="",
                download_url="",
                job_id=job.id,
            )

        output_path, srt_path = run_export(
            session,
            burn_subtitles=body.burn_subtitles,
            output_filename=body.filename or session.name,
            export_srt=body.export_srt,
            use_source_video=body.use_source_video,
        )
        project_clip_path: str | None = None
        if body.write_back_to_project:
            project_clip_path = service.write_export_to_project(
                project_id,
                session,
                output_path,
                title=body.filename or session.name,
            )
        rel = output_path.relative_to(get_project_directory(project_id)).as_posix()
        srt_rel: str | None = None
        srt_download_url: str | None = None
        if srt_path is not None:
            srt_rel = srt_path.relative_to(get_project_directory(project_id)).as_posix()
            srt_download_url = (
                f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/exports/{srt_path.name}"
            )
        from backend.utils.export_local import copy_export_outputs

        local_video, local_srt = copy_export_outputs(output_path, srt_path, body.output_dir)
        return EditSessionExportResponse(
            success=True,
            output_path=rel,
            download_url=f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/exports/{output_path.name}",
            srt_path=srt_rel,
            srt_download_url=srt_download_url,
            project_clip_path=project_clip_path,
            local_output_path=str(local_video),
            local_srt_path=str(local_srt) if local_srt else None,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("导出剪辑工程失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/{project_id}/edit-sessions/{session_id}/export/compositor-staging",
)
async def get_compositor_staging_path(project_id: str, session_id: str):
    from backend.pipeline.edit_renderer import resolve_compositor_staging_path

    path = resolve_compositor_staging_path(project_id, session_id)
    return {"path": str(path.resolve())}


@router.post(
    "/{project_id}/edit-sessions/{session_id}/export/compositor-mux",
    response_model=EditSessionExportResponse,
)
async def mux_compositor_export_video(
    project_id: str,
    session_id: str,
    body: EditSessionCompositorMuxRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from pathlib import Path

    from backend.core.path_utils import get_project_directory
    from backend.pipeline.edit_renderer import (
        mux_compositor_export as run_mux,
        resolve_compositor_video_path,
    )
    from backend.utils.export_local import copy_export_outputs

    try:
        session = service.get_session(project_id, session_id)
        try:
            compositor_video = resolve_compositor_video_path(
                project_id,
                session_id,
                body.compositor_video_path,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        loop = asyncio.get_event_loop()
        mux_result = await loop.run_in_executor(
            None,
            lambda: run_mux(
                session,
                compositor_video,
                output_filename=body.filename or session.name,
                export_srt=body.export_srt,
                use_source_video=body.use_source_video,
                block_id=body.block_id,
                compositor_duration_sec=body.compositor_duration_sec,
            ),
        )

        project_clip_path: str | None = None
        if body.write_back_to_project:
            project_clip_path = service.write_export_to_project(
                project_id,
                session,
                mux_result.output_path,
                title=body.filename or session.name,
            )

        rel = mux_result.output_path.relative_to(get_project_directory(project_id)).as_posix()
        srt_rel: str | None = None
        srt_download_url: str | None = None
        if mux_result.srt_path is not None:
            srt_rel = mux_result.srt_path.relative_to(get_project_directory(project_id)).as_posix()
            srt_download_url = (
                f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/exports/{mux_result.srt_path.name}"
            )

        local_video, local_srt = copy_export_outputs(mux_result.output_path, mux_result.srt_path, body.output_dir)
        return EditSessionExportResponse(
            success=True,
            output_path=rel,
            download_url=f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/exports/{mux_result.output_path.name}",
            srt_path=srt_rel,
            srt_download_url=srt_download_url,
            project_clip_path=project_clip_path,
            local_output_path=str(local_video),
            local_srt_path=str(local_srt) if local_srt else None,
            audio_mixed=mux_result.audio_mixed,
            audio_warning=mux_result.audio_warning,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Compositor 混音导出失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/{project_id}/edit-sessions/{session_id}/export/compositor-plan",
    response_model=EditSessionCompositorPlanResponse,
)
async def get_compositor_export_plan(
    project_id: str,
    session_id: str,
    burn_subtitles: bool = True,
    use_source_video: Optional[bool] = None,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.pipeline.scene_builder import compile_export_plan, serialize_export_plan

    try:
        session = service.get_session(project_id, session_id)
        plan = compile_export_plan(
            session,
            burn_subtitles=burn_subtitles,
            use_source_video=use_source_video,
        )
        return EditSessionCompositorPlanResponse(
            project_id=project_id,
            session_id=session_id,
            plan=serialize_export_plan(plan),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except Exception as exc:
        logger.exception("编译 Compositor Plan 失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/export/headless",
    response_model=EditSessionExportResponse,
)
async def start_headless_compositor_export(
    project_id: str,
    session_id: str,
    body: EditSessionHeadlessExportRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.services.edit_export_job_service import edit_export_job_service

    try:
        session = service.get_session(project_id, session_id)
        job = edit_export_job_service.start_headless_compositor_export(
            project_id=project_id,
            session_id=session_id,
            session_payload=session.model_dump(),
            burn_subtitles=body.burn_subtitles,
            export_srt=body.export_srt,
            use_source_video=body.use_source_video,
            output_dir=body.output_dir,
            filename=body.filename,
        )
        return EditSessionExportResponse(
            success=True,
            output_path=job.output_path or "",
            download_url="",
            job_id=job.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except Exception as exc:
        logger.exception("创建 Headless Compositor 任务失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/{project_id}/edit-sessions/{session_id}/export-jobs/{job_id}",
    response_model=EditSessionExportJobStatusResponse,
)
async def get_edit_session_export_job(
    project_id: str,
    session_id: str,
    job_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.services.edit_export_job_service import edit_export_job_service

    try:
        service.get_session(project_id, session_id)
        job = edit_export_job_service.get_job(job_id)
        if job.session_id != session_id or job.project_id != project_id:
            raise HTTPException(status_code=404, detail="导出任务不存在")
        return EditSessionExportJobStatusResponse(
            job_id=job.id,
            status=job.status,
            progress=job.progress,
            message=job.message,
            job_type=job.job_type,
            download_url=job.download_url,
            srt_download_url=job.srt_download_url,
            output_path=job.output_path,
            srt_path=job.srt_path,
            project_clip_path=job.project_clip_path,
            local_output_path=job.local_output_path,
            local_srt_path=job.local_srt_path,
            files=[
                EditSessionBatchExportItem(
                    block_id=item.block_id,
                    title=item.title,
                    output_path=item.output_path,
                    download_url=item.download_url,
                    srt_path=item.srt_path,
                    srt_download_url=item.srt_download_url,
                    local_output_path=item.local_output_path,
                    local_srt_path=item.local_srt_path,
                )
                for item in job.batch_files
            ]
            if job.batch_files
            else None,
            error=job.error,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="导出任务不存在") from exc


@router.post("/{project_id}/edit-sessions/{session_id}/bgm")
async def upload_edit_session_bgm(
    project_id: str,
    session_id: str,
    file: UploadFile = File(...),
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="BGM 文件为空")
        return service.save_bgm_file(
            project_id,
            session_id,
            file.filename or "bgm.mp3",
            content,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("上传 BGM 失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/sfx")
async def upload_edit_session_sfx(
    project_id: str,
    session_id: str,
    file: UploadFile = File(...),
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="音效文件为空")
        return service.save_sfx_file(
            project_id,
            session_id,
            file.filename or "sfx.mp3",
            content,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("上传音效失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/bgm/from-url")
async def import_edit_session_bgm_from_url(
    project_id: str,
    session_id: str,
    payload: EditSessionImportBgmUrlRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.utils.link_audio_downloader import UnsupportedLinkPlatformError, LinkDownloadError

    try:
        return service.import_bgm_from_url(
            project_id,
            session_id,
            payload.url.strip(),
            platform=payload.platform,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except UnsupportedLinkPlatformError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (LinkDownloadError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("从链接导入 BGM 失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/import-media",
    response_model=EditSessionImportMediaResponse,
)
async def import_edit_session_media(
    project_id: str,
    session_id: str,
    file: UploadFile = File(...),
    insert_index: int | None = Form(default=None),
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="缺少文件名")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="视频文件为空")
        session, block = service.import_media_file(
            project_id,
            session_id,
            file.filename,
            content,
            insert_index=insert_index,
        )
        return EditSessionImportMediaResponse(
            session=session,
            block_id=block.id,
            title=block.title,
            duration_sec=block.duration_sec,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("导入视频失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/edit-sessions/{session_id}/blocks/{block_id}/media")
async def stream_edit_session_block_media(
    project_id: str,
    session_id: str,
    block_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from fastapi.responses import FileResponse

    from backend.core.path_utils import get_project_directory
    from backend.pipeline.edit_renderer import _resolve_input_video

    try:
        session = service.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == block_id), None)
        if block is None:
            raise HTTPException(status_code=404, detail="片段不存在")
        project_dir = get_project_directory(project_id)
        video_path = _resolve_input_video(project_dir, block)
        return FileResponse(
            path=str(video_path.resolve()),
            media_type="video/mp4",
            filename=video_path.name,
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"},
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("读取片段媒体失败: %s/%s/%s", project_id, session_id, block_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/edit-sessions/{session_id}/audio-assets/{asset_id}")
async def stream_edit_session_audio_asset(
    project_id: str,
    session_id: str,
    asset_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from fastapi.responses import FileResponse

    from backend.utils.bgm_audio import bgm_media_type, ensure_browser_playable_bgm

    try:
        asset_path = service.resolve_audio_asset_path(project_id, session_id, asset_id)
        stream_path = ensure_browser_playable_bgm(asset_path)
        return FileResponse(
            path=str(stream_path.resolve()),
            media_type=bgm_media_type(stream_path),
            filename=stream_path.name,
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"},
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{project_id}/edit-sessions/{session_id}/bgm")
async def stream_edit_session_bgm(
    project_id: str,
    session_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from fastapi.responses import FileResponse

    from backend.core.path_utils import get_project_directory

    from backend.utils.bgm_audio import bgm_media_type, ensure_browser_playable_bgm

    try:
        session = service.get_session(project_id, session_id)
        bgm_rel = session.audio_settings.bgm_path
        if not bgm_rel:
            raise HTTPException(status_code=404, detail="未设置 BGM")
        bgm_path = get_project_directory(project_id) / bgm_rel
        if not bgm_path.exists():
            raise HTTPException(status_code=404, detail="BGM 文件不存在")
        stream_path = ensure_browser_playable_bgm(bgm_path)
        return FileResponse(
            path=str(stream_path.resolve()),
            media_type=bgm_media_type(stream_path),
            filename=stream_path.name,
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"},
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc


@router.get("/{project_id}/edit-sessions/{session_id}/exports/{filename}")
async def download_edit_session_export(
    project_id: str,
    session_id: str,
    filename: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from fastapi.responses import FileResponse

    from backend.core.path_utils import get_project_directory

    try:
        service.get_session(project_id, session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc

    export_path = get_project_directory(project_id) / "edit_exports" / session_id / filename
    if not export_path.exists():
        raise HTTPException(status_code=404, detail="导出文件不存在")
    media_type = "application/x-subrip" if filename.lower().endswith(".srt") else "video/mp4"
    return FileResponse(
        path=str(export_path.resolve()),
        media_type=media_type,
        filename=filename,
    )


@router.post(
    "/{project_id}/edit-sessions/{session_id}/bilibili-upload",
    response_model=EditSessionBilibiliUploadResponse,
)
async def upload_edit_export_to_bilibili(
    project_id: str,
    session_id: str,
    body: EditSessionBilibiliUploadRequest,
    service: EditSessionService = Depends(get_edit_session_service),
    db: Session = Depends(get_db),
):
    import json
    from uuid import UUID

    from backend.core.path_utils import get_project_directory
    from backend.models.bilibili import BilibiliUploadRecord
    from backend.services.bilibili_service import BilibiliAccountService, BilibiliUploadService

    try:
        service.get_session(project_id, session_id)
        export_path = (
            get_project_directory(project_id)
            / "edit_exports"
            / session_id
            / body.export_filename
        )
        if not export_path.exists():
            raise HTTPException(status_code=404, detail="导出文件不存在，请先完成导出")

        account_service = BilibiliAccountService(db)
        account = account_service.get_account_by_id(body.account_id)
        if account is None:
            raise HTTPException(status_code=400, detail="B 站账号不存在")

        record = BilibiliUploadRecord(
            project_id=UUID(project_id),
            account_id=body.account_id,
            clip_id=f"edit:{session_id}",
            title=body.title,
            description=body.description,
            tags=json.dumps(body.tags, ensure_ascii=False),
            partition_id=body.partition_id,
            video_path=str(export_path.resolve()),
            status="pending",
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        upload_service = BilibiliUploadService(db)
        upload_service.start_upload_record(record.id)

        return EditSessionBilibiliUploadResponse(
            success=True,
            record_id=record.id,
            message="投稿任务已创建，正在后台上传",
            upload_status_path=f"/upload-status?record_id={record.id}",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("剪辑导出投稿失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def get_editor_agent_service() -> EditorAgentService:
    return EditorAgentService()


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/analyze-layout",
    response_model=AnalyzeLayoutResponse,
)
async def analyze_edit_session_layout(
    project_id: str,
    session_id: str,
    body: AnalyzeLayoutRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """参考图排版分析（Phase A：不修改时间线）。"""
    try:
        session_service.get_session(project_id, session_id)
        return agent_service.analyze_layout(body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("排版分析失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/analyze-subtitle-frame",
    response_model=AnalyzeSubtitleFrameResponse,
)
async def analyze_edit_session_subtitle_frame(
    project_id: str,
    session_id: str,
    body: AnalyzeSubtitleFrameRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """字幕帧视觉验证：前端截帧 + 画面分析子 Agent，返回简短 JSON（不含 JPEG）。"""
    try:
        session_service.get_session(project_id, session_id)
        return agent_service.analyze_subtitle_frame(body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("字幕帧分析失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/chat",
    response_model=AgentChatResponse,
)
async def agent_edit_session_chat(
    project_id: str,
    session_id: str,
    body: AgentChatRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """剪辑 Agent 对话（Phase B：返回 tool_calls，由前端执行）。"""
    try:
        session_service.get_session(project_id, session_id)
        return agent_service.chat(body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Agent 对话失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

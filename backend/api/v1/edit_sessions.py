"""剪辑工程 API。"""
from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from collections.abc import Callable
from typing import TypeVar

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response, StreamingResponse
from starlette.concurrency import iterate_in_threadpool
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
    EditSessionImportMediaPathRequest,
    EditSessionImportLibraryAssetRequest,
    EditSessionBlockMediaProbeResponse,
    EditSessionImportBgmUrlRequest,
    EditSessionListResponse,
    EditSessionPreviewOverlayRequest,
    EditSessionRegenerateRequest,
    EditSessionRegenerateResponse,
    EditSessionSilenceDetectRequest,
    EditSessionSilenceDetectResponse,
    EditSessionSilenceRegion,
    EditSessionTtsRequest,
    EditSessionTtsResponse,
    EditSessionUpdateRequest,
)
from backend.schemas.editor_agent import (
    AnalyzeLayoutRequest,
    AnalyzeLayoutResponse,
    AnalyzeSubtitleFrameRequest,
    AnalyzeSubtitleFrameResponse,
    AnalyzeVideoContentRequest,
    AnalyzeVideoContentResponse,
    FindBlockMomentsRequest,
    FindBlockMomentsResponse,
    ClassifyAgentIntentRequest,
    ClassifyAgentIntentResponse,
    ExportMomentClipsRequest,
    ExportMomentClipsResponse,
    AgentChatRequest,
    AgentChatResponse,
)
from backend.core.path_utils import get_project_directory
from backend.schemas.voiceover_plan import (
    VoiceoverApplyBrollRequest,
    VoiceoverExecuteRequest,
    VoiceoverExecuteResponse,
    VoiceoverGenerateRequest,
    VoiceoverGenerateResponse,
    VoiceoverPlanResponse,
    VoiceoverRegenerateSegmentRequest,
    VoiceoverSearchMaterialsRequest,
    VoiceoverSelectMaterialRequest,
    VoiceoverUpdatePlanRequest,
)
from backend.services.edit_session_service import EditSessionService, _edit_sessions_dir
from backend.services.editor_agent_service import EditorAgentService
from backend.services.voiceover_plan_service import VoiceoverPlanService

logger = logging.getLogger(__name__)

router = APIRouter()


def get_edit_session_service(db: Session = Depends(get_db)) -> EditSessionService:
    return EditSessionService(db=db)


def get_voiceover_plan_service(db: Session = Depends(get_db)) -> VoiceoverPlanService:
    return VoiceoverPlanService(session_service=EditSessionService(db=db))


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
        return await asyncio.to_thread(service.update_session, project_id, session_id, body)
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


@router.get("/{project_id}/edit-sessions/{session_id}/pool-clips")
async def list_edit_session_pool_clips(project_id: str, session_id: str):
    from backend.services.session_clip_pool_service import list_session_pool_clips

    try:
        return {"items": list_session_pool_clips(project_id, session_id)}
    except Exception as exc:
        logger.exception("列出草稿素材池失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/edit-sessions/{session_id}/pool-clips/{clip_id}/video")
async def stream_edit_session_pool_clip_video(
    project_id: str,
    session_id: str,
    clip_id: str,
):
    from fastapi.responses import FileResponse

    from backend.services.session_clip_pool_service import resolve_session_pool_video_path

    path = resolve_session_pool_video_path(project_id, session_id, clip_id)
    if path is None:
        raise HTTPException(status_code=404, detail="草稿素材不存在")
    return FileResponse(
        path=str(path.resolve()),
        media_type="video/mp4",
        filename=path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@router.delete("/{project_id}/edit-sessions/{session_id}/pool-clips/{clip_id}")
async def delete_edit_session_pool_clip(
    project_id: str,
    session_id: str,
    clip_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    from backend.services.session_clip_pool_service import delete_session_pool_clip

    try:
        delete_session_pool_clip(project_id, session_id, clip_id)
        if service.db is not None:
            from backend.models.clip import Clip

            clip = (
                service.db.query(Clip)
                .filter(Clip.id == clip_id, Clip.project_id == project_id)
                .first()
            )
            if clip is not None:
                service.db.delete(clip)
                service.db.commit()
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("删除草稿素材失败: %s/%s/%s", project_id, session_id, clip_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/edit-sessions/{session_id}/pool-clips/{clip_id}/promote-to-library")
async def promote_edit_session_pool_clip_to_library(
    project_id: str,
    session_id: str,
    clip_id: str,
):
    from backend.services.material_library_service import promote_session_clip_to_library

    try:
        asset = promote_session_clip_to_library(project_id, session_id, clip_id)
        return {"ok": True, "asset": asset}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("收藏到素材库失败: %s/%s/%s", project_id, session_id, clip_id)
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


@router.post("/{project_id}/edit-sessions/{session_id}/tts/preview")
async def preview_edit_session_tts(
    project_id: str,
    session_id: str,
    payload: EditSessionTtsRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        audio_bytes, media_type = await service.preview_speech(
            project_id,
            session_id,
            payload.text,
            voice=payload.voice,
            rate=payload.rate,
        )
        return Response(content=audio_bytes, media_type=media_type)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("文本预读失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/tts",
    response_model=EditSessionTtsResponse,
)
async def synthesize_edit_session_tts(
    project_id: str,
    session_id: str,
    payload: EditSessionTtsRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    try:
        session, asset_id, duration_sec, voice = await service.synthesize_speech(
            project_id,
            session_id,
            payload.text,
            voice=payload.voice,
            rate=payload.rate,
            overlay_id=payload.overlay_id,
        )
        return EditSessionTtsResponse(
            session=session,
            asset_id=asset_id,
            duration_sec=duration_sec,
            voice=voice,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("文本转语音失败: %s/%s", project_id, session_id)
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
    """Web 端：流式上传视频（分块写盘，避免整文件进内存）。"""
    dest: Path | None = None
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="缺少文件名")

        project_dir = get_project_directory(project_id)
        media_dir = _edit_sessions_dir(project_dir) / session_id / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        suffix = EditSessionService._normalize_import_suffix(Path(file.filename).suffix)
        import_id = f"import-{uuid.uuid4().hex[:12]}"
        dest = media_dir / f"{import_id}{suffix}"

        total_bytes = 0
        with dest.open("wb") as f_out:
            while True:
                chunk = await file.read(EditSessionService._IMPORT_COPY_CHUNK_BYTES)
                if not chunk:
                    break
                f_out.write(chunk)
                total_bytes += len(chunk)

        if total_bytes <= 0:
            if dest.exists():
                dest.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="视频文件为空")

        session, block = service.import_media_file_to_path(
            project_id,
            session_id,
            file.filename,
            dest,
            insert_index=insert_index,
        )
        return EditSessionImportMediaResponse(
            session=session,
            block_id=block.id,
            title=block.title,
            duration_sec=block.duration_sec,
            import_method="upload",
        )
    except FileNotFoundError as exc:
        if dest and dest.exists():
            dest.unlink(missing_ok=True)
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        if dest and dest.exists():
            dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        if dest and dest.exists():
            dest.unlink(missing_ok=True)
        raise
    except Exception as exc:
        if dest and dest.exists():
            dest.unlink(missing_ok=True)
        logger.exception("导入视频失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/import-media-path",
    response_model=EditSessionImportMediaResponse,
)
async def import_edit_session_media_path(
    project_id: str,
    session_id: str,
    body: EditSessionImportMediaPathRequest,
    service: EditSessionService = Depends(get_edit_session_service),
):
    """桌面端：从本地路径导入视频（硬链接/引用，避免整文件复制）。"""
    try:
        session, block, import_method = service.import_media_from_path(
            project_id,
            session_id,
            body.source_path,
            insert_index=body.insert_index,
        )
        return EditSessionImportMediaResponse(
            session=session,
            block_id=block.id,
            title=block.title,
            duration_sec=block.duration_sec,
            import_method=import_method,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("路径导入视频失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/import-library-asset",
    response_model=EditSessionImportMediaResponse,
)
async def import_edit_session_library_asset(
    project_id: str,
    session_id: str,
    body: EditSessionImportLibraryAssetRequest,
):
    from backend.services.material_library_service import import_library_asset_to_session

    try:
        session, block, import_method = import_library_asset_to_session(
            project_id,
            session_id,
            body.asset_id,
            insert_index=body.insert_index,
        )
        return EditSessionImportMediaResponse(
            session=session,
            block_id=block.id,
            title=block.title,
            duration_sec=block.duration_sec,
            import_method=import_method,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("从素材库导入失败: %s/%s asset=%s", project_id, session_id, body.asset_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/{project_id}/edit-sessions/{session_id}/blocks/{block_id}/media-probe",
    response_model=EditSessionBlockMediaProbeResponse,
)
async def probe_edit_session_block_media(
    project_id: str,
    session_id: str,
    block_id: str,
    service: EditSessionService = Depends(get_edit_session_service),
):
    """服务端 ffprobe 探测导入片段时长（比浏览器 metadata 更快）。"""
    try:
        duration_sec = service.probe_imported_block_duration(
            project_id,
            session_id,
            block_id,
        )
        return EditSessionBlockMediaProbeResponse(
            duration_sec=duration_sec,
            ready=duration_sec > 0,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("探测片段时长失败: %s/%s/%s", project_id, session_id, block_id)
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


T = TypeVar("T")


async def _run_agent_sync(func: Callable[..., T], *args, **kwargs) -> T:
    """Agent/LLM 为同步阻塞调用，须放线程池以免拖死 /health 等并发请求。"""
    return await asyncio.to_thread(func, *args, **kwargs)


async def _run_voiceover_async(coro):
    """口播 orchestrator 为 async；放入线程池执行，避免长时间占用主事件循环。"""
    return await asyncio.to_thread(asyncio.run, coro)


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
        return await _run_agent_sync(agent_service.analyze_layout, body)
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
        return await _run_agent_sync(agent_service.analyze_subtitle_frame, body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("字幕帧分析失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/analyze-video-content",
    response_model=AnalyzeVideoContentResponse,
)
async def analyze_edit_session_video_content(
    project_id: str,
    session_id: str,
    body: AnalyzeVideoContentRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """视频片段内容分析：前端多帧抽帧 + 音频静音分段 + 视觉子 Agent。"""
    try:
        session_service.get_session(project_id, session_id)
        return await _run_agent_sync(agent_service.analyze_video_content, body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("视频内容分析失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/classify-intent",
    response_model=ClassifyAgentIntentResponse,
)
async def classify_edit_session_agent_intent(
    project_id: str,
    session_id: str,
    body: ClassifyAgentIntentRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """LLM 判断用户意图应走哪种 Agent 模式（片段检索/内容分析/导出缓存/通用对话）。"""
    try:
        session_service.get_session(project_id, session_id)
        return await _run_agent_sync(agent_service.classify_intent, body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("意图路由失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/find-block-moments",
    response_model=FindBlockMomentsResponse,
)
async def find_edit_session_block_moments(
    project_id: str,
    session_id: str,
    body: FindBlockMomentsRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """按用户条件在片段转写文本中检索匹配时间段。"""
    try:
        session = session_service.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == body.block_id), None)
        if block is None:
            raise ValueError(f"片段不存在: {body.block_id}")
        return await _run_agent_sync(
            agent_service.find_block_moments,
            body,
            block.model_dump(),
            session_id,
            project_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("片段检索失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/agent/find-block-moments/stream",
)
async def stream_edit_session_block_moments(
    project_id: str,
    session_id: str,
    body: FindBlockMomentsRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
    agent_service: EditorAgentService = Depends(get_editor_agent_service),
):
    """滑窗 clip 分类渐进输出（NDJSON：progress / clip_score / matches / done）。"""
    try:
        session = session_service.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == body.block_id), None)
        if block is None:
            raise ValueError(f"片段不存在: {body.block_id}")

        def event_stream():
            yield from agent_service.iter_find_block_moments_stream(
                body,
                block.model_dump(),
                session_id,
                project_id,
            )

        return StreamingResponse(
            iterate_in_threadpool(event_stream()),
            media_type="application/x-ndjson",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("片段检索流式失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/export-moment-clips",
    response_model=ExportMomentClipsResponse,
)
async def export_edit_session_moment_clips(
    project_id: str,
    session_id: str,
    body: ExportMomentClipsRequest,
    session_service: EditSessionService = Depends(get_edit_session_service),
):
    """将 Agent 检索匹配片段 ffmpeg 切出并写入项目素材池。"""
    try:
        result = session_service.export_moment_matches_to_clip_pool(
            project_id,
            session_id,
            body.block_id,
            [match.model_dump() for match in body.matches],
        )
        return ExportMomentClipsResponse(
            block_id=result["block_id"],
            created_count=int(result.get("created_count") or 0),
            clip_ids=list(result.get("clip_ids") or []),
            note=str(result.get("note") or ""),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("moment 导出素材池失败: %s/%s", project_id, session_id)
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
        return await _run_agent_sync(agent_service.chat, body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Agent 对话失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/{project_id}/edit-sessions/{session_id}/voiceover/plan",
    response_model=VoiceoverPlanResponse,
)
async def get_voiceover_plan(
    project_id: str,
    session_id: str,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan = service.get_plan(project_id, session_id)
        return VoiceoverPlanResponse(session=session, plan=plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/generate",
    response_model=VoiceoverGenerateResponse,
)
async def generate_voiceover_plan_endpoint(
    project_id: str,
    session_id: str,
    body: VoiceoverGenerateRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan, note = await asyncio.to_thread(
            service.generate_plan,
            project_id,
            session_id,
            body,
        )
        return VoiceoverGenerateResponse(session=session, plan=plan, note=note)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播脚本生成失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/{project_id}/edit-sessions/{session_id}/voiceover/plan",
    response_model=VoiceoverPlanResponse,
)
async def update_voiceover_plan(
    project_id: str,
    session_id: str,
    body: VoiceoverUpdatePlanRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(
            service.update_plan,
            project_id,
            session_id,
            body,
        )
        return VoiceoverPlanResponse(session=session, plan=session.voiceover_plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/confirm",
    response_model=VoiceoverPlanResponse,
)
async def confirm_voiceover_plan(
    project_id: str,
    session_id: str,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(service.confirm_plan, project_id, session_id)
        return VoiceoverPlanResponse(session=session, plan=session.voiceover_plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/reset-draft",
    response_model=VoiceoverPlanResponse,
)
async def reset_voiceover_plan_draft(
    project_id: str,
    session_id: str,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(service.reset_plan_to_draft, project_id, session_id)
        return VoiceoverPlanResponse(session=session, plan=session.voiceover_plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete(
    "/{project_id}/edit-sessions/{session_id}/voiceover/plan",
    response_model=VoiceoverPlanResponse,
)
async def delete_voiceover_plan(
    project_id: str,
    session_id: str,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(service.delete_plan, project_id, session_id)
        return VoiceoverPlanResponse(session=session, plan=None)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/regenerate-segment",
    response_model=VoiceoverPlanResponse,
)
async def regenerate_voiceover_segment_endpoint(
    project_id: str,
    session_id: str,
    body: VoiceoverRegenerateSegmentRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(
            service.regenerate_segment,
            project_id,
            session_id,
            body,
        )
        return VoiceoverPlanResponse(session=session, plan=session.voiceover_plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播分段重写失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/segments",
    response_model=VoiceoverPlanResponse,
)
async def add_voiceover_segment(
    project_id: str,
    session_id: str,
    after_segment_id: str | None = Query(default=None),
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(
            service.add_segment,
            project_id,
            session_id,
            after_segment_id=after_segment_id,
        )
        return VoiceoverPlanResponse(session=session, plan=session.voiceover_plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete(
    "/{project_id}/edit-sessions/{session_id}/voiceover/segments/{segment_id}",
    response_model=VoiceoverPlanResponse,
)
async def remove_voiceover_segment(
    project_id: str,
    session_id: str,
    segment_id: str,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session = await asyncio.to_thread(
            service.remove_segment,
            project_id,
            session_id,
            segment_id,
        )
        return VoiceoverPlanResponse(session=session, plan=session.voiceover_plan)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/execute",
    response_model=VoiceoverExecuteResponse,
)
async def execute_voiceover_plan(
    project_id: str,
    session_id: str,
    body: VoiceoverExecuteRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan, note = await _run_voiceover_async(
            service.execute_plan(project_id, session_id, body)
        )
        return VoiceoverExecuteResponse(session=session, plan=plan, note=note)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播执行失败: %s/%s", project_id, session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/execute-segment/{segment_id}",
    response_model=VoiceoverExecuteResponse,
)
async def execute_voiceover_segment(
    project_id: str,
    session_id: str,
    segment_id: str,
    body: VoiceoverExecuteRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan, note = await _run_voiceover_async(
            service.execute_segment(
                project_id,
                session_id,
                segment_id,
                placeholder_library_asset_id=body.placeholder_library_asset_id,
            )
        )
        return VoiceoverExecuteResponse(session=session, plan=plan, note=note)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播分段执行失败: %s/%s segment=%s", project_id, session_id, segment_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/segments/{segment_id}/search-materials",
    response_model=VoiceoverExecuteResponse,
)
async def search_voiceover_segment_materials(
    project_id: str,
    session_id: str,
    segment_id: str,
    body: VoiceoverSearchMaterialsRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan, note = await asyncio.to_thread(
            service.search_segment_materials,
            project_id,
            session_id,
            segment_id,
            body,
        )
        return VoiceoverExecuteResponse(session=session, plan=plan, note=note)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播素材搜索失败: %s/%s segment=%s", project_id, session_id, segment_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/segments/{segment_id}/select-material",
    response_model=VoiceoverExecuteResponse,
)
async def select_voiceover_segment_material(
    project_id: str,
    session_id: str,
    segment_id: str,
    body: VoiceoverSelectMaterialRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan, note = await asyncio.to_thread(
            service.select_segment_material,
            project_id,
            session_id,
            segment_id,
            body,
        )
        return VoiceoverExecuteResponse(session=session, plan=plan, note=note)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播素材选定失败: %s/%s segment=%s", project_id, session_id, segment_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{project_id}/edit-sessions/{session_id}/voiceover/segments/{segment_id}/apply-broll",
    response_model=VoiceoverExecuteResponse,
)
async def apply_voiceover_segment_broll(
    project_id: str,
    session_id: str,
    segment_id: str,
    body: VoiceoverApplyBrollRequest,
    service: VoiceoverPlanService = Depends(get_voiceover_plan_service),
):
    try:
        session, plan, note = await asyncio.to_thread(
            service.apply_segment_broll,
            project_id,
            session_id,
            segment_id,
            body,
        )
        return VoiceoverExecuteResponse(session=session, plan=plan, note=note)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="剪辑工程不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("口播 B-roll 应用失败: %s/%s segment=%s", project_id, session_id, segment_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

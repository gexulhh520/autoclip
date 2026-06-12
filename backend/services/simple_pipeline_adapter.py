"""
简化的流水线适配器 - 委托 PipelineOrchestrator 执行，自身只负责进度与字幕生成。
"""

import logging
from pathlib import Path
from typing import Any, Dict, Optional

from backend.pipeline.orchestrator import PipelineOrchestrator
from backend.pipeline.pipelines.definitions import ALL_PIPELINE_STEP_IDS

# 续跑 API 兼容别名
PIPELINE_STEP_ORDER = ALL_PIPELINE_STEP_IDS
from backend.services.simple_progress import clear_progress, emit_progress

logger = logging.getLogger(__name__)

# 续跑 API 兼容
__all__ = ["SimplePipelineAdapter", "create_simple_pipeline_adapter", "PIPELINE_STEP_ORDER"]


class SimplePipelineAdapter:
    """桌面端流水线入口：薄适配层，不含 clip_goal 分支。"""

    def __init__(
        self,
        project_id: str,
        task_id: str,
        source_id: Optional[str] = None,
        source_index: Optional[int] = None,
        source_filename: Optional[str] = None,
    ):
        self.project_id = project_id
        self.task_id = task_id
        self.source_id = source_id
        self.source_index = source_index
        self.source_filename = source_filename

    def _load_project_settings(self) -> dict:
        try:
            from backend.core.database import SessionLocal
            from backend.models.project import Project

            db = SessionLocal()
            try:
                project = db.query(Project).filter(Project.id == self.project_id).first()
                if project and project.processing_config:
                    from backend.pipeline.template_engine import merge_template_settings
                    return merge_template_settings(dict(project.processing_config))
            finally:
                db.close()
        except Exception as exc:
            logger.warning("读取项目配置失败 %s: %s", self.project_id, exc)
        return {}

    async def _generate_subtitle_automatically(self, video_path: str, metadata_dir: Path) -> Optional[Path]:
        try:
            logger.info("开始为视频 %s 自动生成字幕", video_path)
            emit_progress(self.project_id, "SUBTITLE", "正在使用AI生成字幕...", subpercent=25)

            from backend.utils.speech_recognizer import generate_subtitle_for_video
            from backend.core.path_utils import (
                get_project_directory,
                get_project_source_raw_directory,
            )

            video_file_path = Path(video_path)
            if not video_file_path.exists():
                logger.error("视频文件不存在: %s", video_path)
                return None

            if self.source_id:
                raw_dir = get_project_source_raw_directory(self.project_id, self.source_id)
            else:
                raw_dir = get_project_directory(self.project_id) / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            output_path = raw_dir / "input.srt"

            from backend.core.desktop_config import get_desktop_config

            whisper_model = get_desktop_config().speech_recognition.whisper_config.model_name
            srt_path = generate_subtitle_for_video(
                video_file_path,
                output_path=output_path,
                method="whisper_local",
                model=whisper_model,
                language="auto",
            )

            if srt_path and srt_path.exists():
                logger.info("Whisper 生成字幕成功: %s", srt_path)
                emit_progress(self.project_id, "SUBTITLE", "AI字幕生成完成", subpercent=40)
                return srt_path

            logger.warning("Whisper 生成字幕失败")
            return None
        except Exception as exc:
            logger.error("自动生成字幕失败: %s", exc)
            return None

    async def process_project_sync(
        self,
        input_video_path: str,
        input_srt_path: str,
        start_from_step: Optional[str] = None,
    ) -> Dict[str, Any]:
        logger.info(
            "开始处理项目: %s (start_from_step=%s)",
            self.project_id,
            start_from_step,
        )

        try:
            if not start_from_step:
                clear_progress(self.project_id)

            settings = self._load_project_settings()
            orchestrator = PipelineOrchestrator(
                project_id=self.project_id,
                task_id=self.task_id,
                settings=settings,
                generate_subtitle=self._generate_subtitle_automatically,
                source_id=self.source_id,
                source_index=self.source_index,
                source_filename=self.source_filename,
            )

            result = await orchestrator.run(
                input_video_path=input_video_path,
                input_srt_path=input_srt_path,
                start_from_step=start_from_step,
            )

            if result.status == "failed":
                error_msg = result.error or "处理失败"
                logger.error("项目 %s: %s", self.project_id, error_msg)
                emit_progress(self.project_id, "DONE", f"处理失败: {error_msg}")
                return {
                    "status": "failed",
                    "project_id": self.project_id,
                    "task_id": self.task_id,
                    "error": error_msg,
                }

            emit_progress(self.project_id, "DONE", "处理完成")

            try:
                from backend.services.data_sync_service import DataSyncService
                from backend.core.database import SessionLocal
                from backend.core.path_utils import get_project_directory

                project_dir = get_project_directory(self.project_id)
                db = SessionLocal()
                try:
                    sync_service = DataSyncService(db)
                    sync_result = sync_service.sync_project_from_filesystem(
                        self.project_id, project_dir
                    )
                    if sync_result.get("success"):
                        logger.info("项目 %s 数据同步成功", self.project_id)
                    else:
                        logger.error("项目 %s 数据同步失败: %s", self.project_id, sync_result)
                finally:
                    db.close()
            except Exception as exc:
                logger.error("数据同步失败: %s", exc)

            logger.info("项目处理完成: %s", self.project_id)
            return {
                "status": "succeeded",
                "project_id": self.project_id,
                "task_id": self.task_id,
                "result": {
                    "outlines": result.outlines,
                    "timeline": result.timeline,
                    "scored_clips": result.scored_clips,
                    "titled_clips": result.titled_clips,
                    "collections": result.collections,
                    "video_result": result.video_result,
                },
            }

        except Exception as exc:
            error_msg = f"流水线处理失败: {exc}"
            logger.error(error_msg)
            emit_progress(self.project_id, "DONE", f"处理失败: {error_msg}")
            return {
                "status": "failed",
                "project_id": self.project_id,
                "task_id": self.task_id,
                "error": error_msg,
            }


def create_simple_pipeline_adapter(
    project_id: str,
    task_id: str,
    source_id: Optional[str] = None,
    source_index: Optional[int] = None,
    source_filename: Optional[str] = None,
) -> SimplePipelineAdapter:
    return SimplePipelineAdapter(
        project_id,
        task_id,
        source_id=source_id,
        source_index=source_index,
        source_filename=source_filename,
    )

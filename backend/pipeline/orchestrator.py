"""Pipeline 编排器 — 按 Goal Profile 的步骤组合顺序调度，不含 goal 分支逻辑。"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.core.clip_duration_config import (
    resolve_clip_duration_config,
    save_duration_config_to_metadata,
)
from backend.core.path_utils import get_project_directory
from backend.pipeline.context import PipelineContext
from backend.pipeline.goals.registry import resolve_clip_goal
from backend.pipeline.pipelines.definitions import resolve_step_order, should_run_step
from backend.pipeline.prompt_loader import (
    load_goal_prompt_contents,
    materialize_prompt_files,
    save_goal_config_to_metadata,
)
from backend.pipeline.steps.runners import (
    STEP_LOADERS,
    STEP_RUNNERS,
    run_outline,
    write_empty_artifacts,
)
from backend.pipeline.types import PipelineRunResult
from backend.services.simple_progress import emit_progress

logger = logging.getLogger(__name__)

# step 不在组合里时，outlines 为空需要写入的空产物
_STEP_EMPTY_ARTIFACTS: Dict[str, List[str]] = {
    "step2_timeline": ["timeline"],
    "step3_scoring": ["scored"],
    "step4_title": ["titles", "collections"],
    "step5_clustering": ["collections"],
}


@dataclass
class PipelineStepState:
    outlines: List[Dict] = field(default_factory=list)
    timeline_data: List[Dict] = field(default_factory=list)
    scored_clips: List[Dict] = field(default_factory=list)
    titled_clips: List[Dict] = field(default_factory=list)
    collections: List[Dict] = field(default_factory=list)
    video_result: Dict[str, Any] = field(
        default_factory=lambda: {"status": "skipped", "message": "未执行"}
    )


class PipelineOrchestrator:
    """根据 clip_goal 的步骤组合逐步执行。"""

    def __init__(
        self,
        project_id: str,
        task_id: str,
        settings: Optional[Dict[str, Any]] = None,
        generate_subtitle: Optional[Callable] = None,
    ):
        self.project_id = project_id
        self.task_id = task_id
        self.settings = settings or {}
        self._generate_subtitle = generate_subtitle

    def build_context(
        self,
        input_video_path: str,
        input_srt_path: Optional[str],
        start_from_step: Optional[str] = None,
    ) -> PipelineContext:
        goal = resolve_clip_goal(self.settings)
        video_category = self.settings.get("video_category", "default")

        duration_settings = dict(self.settings)
        if not duration_settings.get("clip_duration_preset"):
            duration_settings["clip_duration_preset"] = goal.default_duration_preset
        duration_config = resolve_clip_duration_config(duration_settings)

        project_dir = get_project_directory(self.project_id)
        metadata_dir = project_dir / "metadata"
        output_dir = project_dir / "output"
        clips_dir = output_dir / "clips"
        collections_dir = output_dir / "collections"
        for d in (metadata_dir, output_dir, clips_dir, collections_dir):
            d.mkdir(parents=True, exist_ok=True)

        save_duration_config_to_metadata(metadata_dir, duration_config)
        save_goal_config_to_metadata(metadata_dir, goal)

        prompts = load_goal_prompt_contents(goal, video_category, duration_config)
        prompt_files = materialize_prompt_files(metadata_dir, prompts)

        step_order = resolve_step_order(goal)
        logger.info(
            "Pipeline 配置: goal=%s pipeline=%s steps=%s duration=%s-%ss category=%s",
            goal.id,
            goal.pipeline_id,
            step_order,
            duration_config.min_seconds,
            duration_config.max_seconds,
            video_category,
        )

        return PipelineContext(
            project_id=self.project_id,
            task_id=self.task_id,
            goal=goal,
            settings=self.settings,
            project_dir=project_dir,
            metadata_dir=metadata_dir,
            output_dir=output_dir,
            clips_dir=clips_dir,
            collections_dir=collections_dir,
            input_video_path=input_video_path,
            input_srt_path=input_srt_path,
            duration_config=duration_config,
            prompts=prompts,
            prompt_files=prompt_files,
            start_from_step=start_from_step,
            emit_progress=emit_progress,
        )

    async def run(
        self,
        input_video_path: str,
        input_srt_path: Optional[str],
        start_from_step: Optional[str] = None,
    ) -> PipelineRunResult:
        ctx = self.build_context(input_video_path, input_srt_path, start_from_step)
        step_order = resolve_step_order(ctx.goal)
        state = PipelineStepState()

        emit_progress(self.project_id, "INGEST", "素材准备完成")

        for step_id in step_order:
            await self._dispatch_step(
                ctx,
                step_id,
                step_order,
                start_from_step,
                state,
                input_srt_path,
                input_video_path,
            )

        emit_progress(self.project_id, "EXPORT", "视频导出完成", subpercent=100)

        if not state.outlines:
            goal_label = ctx.goal.name
            error_msg = (
                f"「{goal_label}」扫描未产生任何有效片段（Step1 大纲为空）。"
                "请检查 LLM 配置，或从 Step1 重试。"
            )
            return PipelineRunResult(
                status="failed",
                outlines=state.outlines,
                timeline=state.timeline_data,
                scored_clips=state.scored_clips,
                titled_clips=state.titled_clips,
                collections=state.collections,
                video_result=state.video_result,
                error=error_msg,
            )

        if state.outlines and not state.titled_clips:
            error_msg = (
                "内容分析未产生有效片段（Step3 评分筛选后为空）。"
                "常见原因：本地模型一次性输出条目过多被截断。"
                "请从 Step3 重试，或改用 qwen2.5vl:7b / 云端模型。"
            )
            return PipelineRunResult(
                status="failed",
                outlines=state.outlines,
                timeline=state.timeline_data,
                scored_clips=state.scored_clips,
                titled_clips=state.titled_clips,
                collections=state.collections,
                video_result=state.video_result,
                error=error_msg,
            )

        return PipelineRunResult(
            status="succeeded",
            outlines=state.outlines,
            timeline=state.timeline_data,
            scored_clips=state.scored_clips,
            titled_clips=state.titled_clips,
            collections=state.collections,
            video_result=state.video_result,
        )

    async def _dispatch_step(
        self,
        ctx: PipelineContext,
        step_id: str,
        step_order: List[str],
        start_from_step: Optional[str],
        state: PipelineStepState,
        input_srt_path: Optional[str],
        input_video_path: str,
    ) -> None:
        if step_id != "step1_outline" and not state.outlines:
            self._skip_step_without_outlines(ctx, step_id, state)
            return

        run_now = should_run_step(step_id, start_from_step, step_order)

        if step_id == "step1_outline":
            await self._run_step1(ctx, run_now, state, input_srt_path, input_video_path)
            return

        if step_id == "step4_title":
            emit_progress(self.project_id, "HIGHLIGHT", "开始片段定位")

        if step_id == "step6_video":
            emit_progress(self.project_id, "HIGHLIGHT", "片段定位完成", subpercent=100)
            emit_progress(self.project_id, "EXPORT", "开始视频导出")

        if run_now:
            logger.info("执行 %s (goal=%s)", step_id, ctx.goal.id)
            self._assign_step_result(step_id, STEP_RUNNERS[step_id](ctx), state)
        elif step_id == "step6_video":
            state.video_result = {"status": "skipped", "message": "已跳过视频切割"}
            logger.info("跳过 step6_video")
        else:
            logger.info("跳过 %s，加载已有结果", step_id)
            self._assign_step_result(step_id, STEP_LOADERS[step_id](ctx), state)

        self._emit_step_progress(step_id, state)

    async def _run_step1(
        self,
        ctx: PipelineContext,
        run_now: bool,
        state: PipelineStepState,
        input_srt_path: Optional[str],
        input_video_path: str,
    ) -> None:
        emit_progress(self.project_id, "SUBTITLE", "开始字幕处理")

        if run_now:
            srt_path = await self.resolve_srt_async(ctx, input_srt_path, input_video_path)
            if srt_path and srt_path.exists():
                logger.info("执行 step1_outline (goal=%s)", ctx.goal.id)
                state.outlines = run_outline(ctx, srt_path)
            else:
                logger.warning("无可用 SRT，写入空大纲")
                state.outlines = []
                ctx.artifact("outline").write_text("[]", encoding="utf-8")
        else:
            state.outlines = STEP_LOADERS["step1_outline"](ctx)
            logger.info("跳过 step1，加载已有大纲 %d 条", len(state.outlines))

        emit_progress(self.project_id, "SUBTITLE", "字幕处理完成", subpercent=50)
        emit_progress(self.project_id, "ANALYZE", "开始内容分析")

    def _skip_step_without_outlines(
        self,
        ctx: PipelineContext,
        step_id: str,
        state: PipelineStepState,
    ) -> None:
        artifact_names = _STEP_EMPTY_ARTIFACTS.get(step_id)
        if artifact_names:
            write_empty_artifacts(ctx, artifact_names)

        if step_id == "step4_title":
            state.titled_clips = []
            state.collections = []
            emit_progress(self.project_id, "HIGHLIGHT", "开始片段定位")
            emit_progress(self.project_id, "HIGHLIGHT", "片段定位完成", subpercent=100)
            emit_progress(self.project_id, "EXPORT", "开始视频导出")
        elif step_id == "step6_video":
            state.video_result = {"status": "skipped", "message": "没有内容可处理"}

    def _assign_step_result(
        self,
        step_id: str,
        result: Any,
        state: PipelineStepState,
    ) -> None:
        if step_id == "step2_timeline":
            state.timeline_data = result
        elif step_id == "step3_scoring":
            state.scored_clips = result
        elif step_id == "step4_title":
            state.titled_clips = result
        elif step_id == "step5_clustering":
            state.collections = result
        elif step_id == "step6_video":
            state.video_result = result

    def _emit_step_progress(self, step_id: str, state: PipelineStepState) -> None:
        if step_id == "step2_timeline":
            emit_progress(self.project_id, "ANALYZE", "时间线提取完成", subpercent=50)
        elif step_id == "step3_scoring":
            emit_progress(self.project_id, "ANALYZE", "内容分析完成", subpercent=100)
        elif step_id == "step4_title":
            emit_progress(self.project_id, "HIGHLIGHT", "标题生成完成", subpercent=40)

    async def resolve_srt_async(
        self,
        ctx: PipelineContext,
        input_srt_path: Optional[str],
        input_video_path: str,
    ) -> Optional[Path]:
        if input_srt_path and Path(input_srt_path).exists():
            return Path(input_srt_path)
        if self._generate_subtitle:
            return await self._generate_subtitle(input_video_path, ctx.metadata_dir)
        return None

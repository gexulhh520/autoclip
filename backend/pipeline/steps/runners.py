"""Pipeline 步骤实现 — 包装现有 step1–6，不含 clip_goal 分支。"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.pipeline.context import PipelineContext
from backend.pipeline.step1_outline import run_step1_outline
from backend.pipeline.step2_timeline import run_step2_timeline
from backend.pipeline.step3_scoring import run_step3_scoring
from backend.pipeline.step4_title import run_step4_title
from backend.pipeline.step5_clustering import run_step5_clustering
from backend.pipeline.step6_video import run_step6_video
from backend.pipeline.types import StepResult

logger = logging.getLogger(__name__)


def _load_json_list(path: Path) -> List[Any]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _prompt_contents_for(ctx: PipelineContext) -> Dict[str, str]:
    return ctx.prompts


def _prompt_files_for(ctx: PipelineContext) -> Dict[str, Path]:
    return ctx.prompt_files


def run_outline(ctx: PipelineContext, srt_path: Path) -> List[Dict]:
    parse_mode = "json" if ctx.goal.pipeline_id == "moment" else "markdown"
    return run_step1_outline(
        srt_path,
        metadata_dir=ctx.metadata_dir,
        prompt_contents=_prompt_contents_for(ctx),
        parse_mode=parse_mode,
    )


def run_timeline(ctx: PipelineContext) -> List[Dict]:
    return run_step2_timeline(
        ctx.artifact("outline"),
        metadata_dir=ctx.metadata_dir,
        prompt_contents=_prompt_contents_for(ctx),
        duration_config=ctx.duration_config,
    )


def run_scoring(ctx: PipelineContext) -> List[Dict]:
    pf = _prompt_files_for(ctx)
    prompt_files = pf if pf else None
    return run_step3_scoring(
        ctx.artifact("timeline"),
        metadata_dir=ctx.metadata_dir,
        prompt_files=prompt_files,
    )


def run_title(ctx: PipelineContext) -> List[Dict]:
    pf = _prompt_files_for(ctx)
    return run_step4_title(
        ctx.artifact("scored"),
        metadata_dir=str(ctx.metadata_dir),
        prompt_files=pf if pf else None,
    )


def run_clustering(ctx: PipelineContext) -> List[Dict]:
    pf = _prompt_files_for(ctx)
    return run_step5_clustering(
        ctx.artifact("titles"),
        metadata_dir=str(ctx.metadata_dir),
        prompt_files=pf if pf else None,
    )


def _apply_source_context_to_clips(ctx: PipelineContext, clips: List[Dict]) -> List[Dict]:
    if not ctx.source_id:
        return clips
    updated: List[Dict] = []
    for clip in clips:
        item = dict(clip)
        raw_id = str(item.get("id", ""))
        if raw_id and not raw_id.startswith(f"{ctx.source_id}_"):
            item["id"] = f"{ctx.source_id}_{raw_id}"
        item["source_id"] = ctx.source_id
        if ctx.source_index is not None:
            item["source_index"] = ctx.source_index
        if ctx.source_filename:
            item["source_filename"] = ctx.source_filename
        updated.append(item)
    return updated


def run_video(ctx: PipelineContext) -> Dict[str, Any]:
    collections_path = ctx.artifact("collections")
    if not collections_path.exists():
        collections_path.write_text("[]", encoding="utf-8")

    titles_path = ctx.artifact("titles")
    clips_with_titles = _load_json_list(titles_path)
    clips_with_titles = _apply_source_context_to_clips(ctx, clips_with_titles)
    if clips_with_titles:
        titles_path.write_text(
            json.dumps(clips_with_titles, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return run_step6_video(
        titles_path,
        collections_path,
        Path(ctx.input_video_path),
        output_dir=ctx.output_dir,
        clips_dir=str(ctx.clips_dir),
        collections_dir=str(ctx.collections_dir),
        metadata_dir=str(ctx.metadata_dir),
        settings=ctx.settings,
    )


def load_outline(ctx: PipelineContext) -> List[Dict]:
    return _load_json_list(ctx.artifact("outline"))


def load_timeline(ctx: PipelineContext) -> List[Dict]:
    return _load_json_list(ctx.artifact("timeline"))


def load_scored(ctx: PipelineContext) -> List[Dict]:
    return _load_json_list(ctx.artifact("scored"))


def load_titles(ctx: PipelineContext) -> List[Dict]:
    return _load_json_list(ctx.artifact("titles"))


def load_collections(ctx: PipelineContext) -> List[Dict]:
    return _load_json_list(ctx.artifact("collections"))


def write_empty_artifacts(ctx: PipelineContext, names: List[str]) -> None:
    for name in names:
        path = ctx.artifact(name)
        path.write_text("[]", encoding="utf-8")


STEP_RUNNERS: Dict[str, Callable[..., Any]] = {
    "step1_outline": run_outline,
    "step2_timeline": run_timeline,
    "step3_scoring": run_scoring,
    "step4_title": run_title,
    "step5_clustering": run_clustering,
    "step6_video": run_video,
}

STEP_LOADERS: Dict[str, Callable[[PipelineContext], List[Dict]]] = {
    "step1_outline": load_outline,
    "step2_timeline": load_timeline,
    "step3_scoring": load_scored,
    "step4_title": load_titles,
    "step5_clustering": load_collections,
}

"""Pipeline 运行时上下文 — 步骤只读 ctx，不直接查数据库。"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from backend.core.clip_duration_config import ClipDurationConfig
from backend.pipeline.goals.base import GoalProfile


ProgressEmitter = Callable[..., None]


@dataclass
class PipelineContext:
    project_id: str
    task_id: str
    goal: GoalProfile
    settings: Dict[str, Any]
    project_dir: Path
    metadata_dir: Path
    output_dir: Path
    clips_dir: Path
    collections_dir: Path
    input_video_path: str
    input_srt_path: Optional[str]
    duration_config: ClipDurationConfig
    prompts: Dict[str, str]  # 已解析的 prompt 文本
    prompt_files: Dict[str, Path]  # 物化到 metadata 的路径，供旧 step 使用
    start_from_step: Optional[str] = None
    emit_progress: Optional[ProgressEmitter] = None

    def artifact(self, name: str) -> Path:
        mapping = {
            "outline": self.metadata_dir / "step1_outline.json",
            "timeline": self.metadata_dir / "step2_timeline.json",
            "scored": self.metadata_dir / "step3_high_score_clips.json",
            "titles": self.metadata_dir / "step4_titles.json",
            "collections": self.metadata_dir / "step5_collections.json",
        }
        return mapping[name]

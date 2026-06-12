"""Pipeline 步骤间传递的数据结构。"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class StepResult:
    """单个步骤的执行结果。"""

    step_id: str
    items: List[Dict[str, Any]] = field(default_factory=list)
    artifacts: Dict[str, Path] = field(default_factory=dict)
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineRunResult:
    """整条 pipeline 的执行结果。"""

    status: str  # succeeded | failed
    outlines: List[Dict[str, Any]] = field(default_factory=list)
    timeline: List[Dict[str, Any]] = field(default_factory=list)
    scored_clips: List[Dict[str, Any]] = field(default_factory=list)
    titled_clips: List[Dict[str, Any]] = field(default_factory=list)
    collections: List[Dict[str, Any]] = field(default_factory=list)
    video_result: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

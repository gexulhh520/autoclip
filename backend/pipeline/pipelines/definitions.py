"""Pipeline 家族定义 — 步骤组合，不含业务逻辑。"""
from __future__ import annotations

from typing import Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.pipeline.goals.base import GoalProfile

# legacy step id，与续跑 API / 前端 pipeline-steps 保持一致
TOPIC_PIPELINE_STEPS: List[str] = [
    "step1_outline",
    "step2_timeline",
    "step3_scoring",
    "step4_title",
    "step5_clustering",
    "step6_video",
]

MOMENT_PIPELINE_STEPS: List[str] = [
    "step1_outline",   # moment: scan_moments（复用 outline 实现，不同 prompt）
    "step2_timeline",  # moment: bound
    "step3_scoring",
    "step4_title",
    "step6_video",
]

PIPELINE_DEFINITIONS: Dict[str, List[str]] = {
    "topic": TOPIC_PIPELINE_STEPS,
    "moment": MOMENT_PIPELINE_STEPS,
}

# 系统已注册的全部步骤（UI / 续跑目录用）
ALL_PIPELINE_STEP_IDS: List[str] = TOPIC_PIPELINE_STEPS


def get_pipeline_steps(pipeline_id: str) -> List[str]:
    """返回某条 pipeline 预设的步骤组合（不做过滤）。"""
    return list(PIPELINE_DEFINITIONS.get(pipeline_id, TOPIC_PIPELINE_STEPS))


def resolve_step_order(goal: "GoalProfile") -> List[str]:
    """
    解析本次运行要执行的步骤顺序：
    - goal.step_ids 显式覆盖（单个 goal 定制组合）
    - 否则查 pipeline_id 预设组合
    """
    if goal.step_ids:
        return list(goal.step_ids)
    return get_pipeline_steps(goal.pipeline_id)


def should_run_step(step_id: str, start_from_step: str | None, step_order: List[str]) -> bool:
    if not start_from_step:
        return True
    if start_from_step not in step_order:
        return True
    return step_order.index(step_id) >= step_order.index(start_from_step)

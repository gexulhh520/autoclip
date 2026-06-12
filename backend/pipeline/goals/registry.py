"""剪辑目标注册表。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import GoalProfile

DEFAULT_CLIP_GOAL = "knowledge"

GOAL_PROFILES: Dict[str, GoalProfile] = {
    "knowledge": GoalProfile(
        id="knowledge",
        name="知识干货",
        description="从长视频中提取完整论述话题，适合 B 站/知识类拆条",
        pipeline_id="topic",
        prompt_pack="knowledge",
        default_duration_preset="standard",
    ),
    "golden_quote": GoalProfile(
        id="golden_quote",
        name="金句爆点",
        description="提取可独立传播的金句与高能 moment，适合口播/短视频",
        pipeline_id="moment",
        prompt_pack="golden_quote",
        default_duration_preset="short",
    ),
    "live_highlight": GoalProfile(
        id="live_highlight",
        name="直播高能",
        description="从直播回放中挖掘情绪峰值与反应 moment",
        pipeline_id="moment",
        prompt_pack="live_highlight",
        default_duration_preset="medium",
    ),
}


def get_goal(goal_id: str) -> GoalProfile:
    return GOAL_PROFILES.get(goal_id) or GOAL_PROFILES[DEFAULT_CLIP_GOAL]


def resolve_clip_goal(settings: Optional[Dict[str, Any]] = None) -> GoalProfile:
    settings = settings or {}
    goal_id = settings.get("clip_goal") or settings.get("clip_goal_id") or DEFAULT_CLIP_GOAL
    return get_goal(str(goal_id))


def list_goal_profiles() -> List[Dict[str, Any]]:
    return [profile.to_dict() for profile in GOAL_PROFILES.values()]

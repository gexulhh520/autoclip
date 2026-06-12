"""剪辑目标（Goal Profile）注册与查询。"""

from .base import GoalProfile
from .registry import (
    DEFAULT_CLIP_GOAL,
    get_goal,
    list_goal_profiles,
    resolve_clip_goal,
)

__all__ = [
    "GoalProfile",
    "DEFAULT_CLIP_GOAL",
    "get_goal",
    "list_goal_profiles",
    "resolve_clip_goal",
]

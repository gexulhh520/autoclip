"""剪辑目标 Profile 数据结构。"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class GoalProfile:
    """
    描述一种剪辑目标：用哪条 pipeline、哪套 prompt、默认参数。
    新增目标只需在此注册 + 添加 prompt 目录，无需改 orchestrator。
    """

    id: str
    name: str
    description: str
    pipeline_id: str  # "topic" | "moment"
    prompt_pack: str  # backend/prompt/goals/{prompt_pack}/
    default_duration_preset: str = "standard"
    scoring_threshold: float = 0.7
    step_ids: Optional[List[str]] = None  # 覆盖 pipeline 默认步骤组合

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

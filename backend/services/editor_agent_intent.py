"""剪辑 Agent 用户意图路由：由 LLM 判断走哪种处理模式。"""
from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

IntentMode = Literal["find_moments", "analyze_content", "export_cached_moments", "agent_chat"]
VisualProfile = Literal["gunplay", "melee", "chase", "action", "none"]
SearchStrategy = Literal["visual_primary", "text_primary"]
RecallMode = Literal["balanced", "high"]
ExportTarget = Literal["pool", "timeline", "none"]

CLASSIFY_AGENT_INTENT_SYSTEM = """你是 AutoClip 剪辑助手的路由器。根据用户一句话判断应走哪种处理模式。
只输出一个 JSON 对象（不要 markdown、不要解释）：

{
  "mode": "find_moments|analyze_content|export_cached_moments|agent_chat",
  "confidence": 0.85,
  "search_criteria": "简短检索条件",
  "visual_profile": "gunplay|melee|chase|action|none",
  "search_strategy": "visual_primary|text_primary",
  "recall_mode": "balanced|high",
  "export_target": "pool|timeline|none",
  "reason": "15字内说明"
}

模式说明：
- find_moments：在视频/片段中按条件找时间段（打斗、枪战、追逐、金句、哲学、共鸣台词、诗歌等）
- analyze_content：理解这段/视频讲了什么、画面内容、节奏如何、适合怎么剪（不是按条件搜片段）
- export_cached_moments：基于上一轮检索结果裁切/导出（刚才、这些、按检索结果、上面的匹配）
- agent_chat：编辑时间线（加字幕、改样式、裁切、删除、移动、加 BGM 等）或一般咨询

visual_profile（画面子类型，仅 find_moments 且 visual_primary 时有效）：
- gunplay：枪战、交火、射击、火力
- melee：打斗、格斗、武打、拳脚
- chase：追逐、追赶、飙车、逃跑
- action：其它动作场面
- none：纯文本检索（金句、哲学等）

search_strategy：
- visual_primary：打斗/枪战/追逐/动作/场景类，主要靠画面
- text_primary：金句/哲学/共鸣/台词/诗歌类，主要靠转写文本

recall_mode：用户说「全部/尽量找全/所有」或找动作场面且像长片 → high，否则 balanced
export_target：素材池/本草稿 → pool；裁到/加入时间线 → timeline；只查找 → none

confidence 低于 0.6 时应 mode=agent_chat。"""

VALID_MODES = {"find_moments", "analyze_content", "export_cached_moments", "agent_chat"}
VALID_PROFILES = {"gunplay", "melee", "chase", "action", "none"}
VALID_STRATEGIES = {"visual_primary", "text_primary"}
VALID_RECALL = {"balanced", "high"}
VALID_EXPORT = {"pool", "timeline", "none"}


class AgentIntentResult(BaseModel):
    mode: IntentMode = "agent_chat"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    search_criteria: str = ""
    visual_profile: VisualProfile = "none"
    search_strategy: SearchStrategy = "text_primary"
    recall_mode: RecallMode = "balanced"
    export_target: ExportTarget = "none"
    reason: str = ""


def classify_agent_intent(llm_manager: Any, user_message: str) -> AgentIntentResult:
    text = (user_message or "").strip()
    if not text:
        return AgentIntentResult(mode="agent_chat", confidence=0.0, reason="空消息")

    messages = [
        {"role": "system", "content": CLASSIFY_AGENT_INTENT_SYSTEM},
        {"role": "user", "content": f"用户消息：{text}"},
    ]
    try:
        response = llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=384,
            timeout=60,
            temperature=0.1,
        )
        parsed = llm_manager.parse_json_response(response.content or "")
    except Exception as exc:
        logger.warning("意图路由 LLM 失败: %s", exc)
        return AgentIntentResult(mode="agent_chat", confidence=0.0, reason="路由失败")

    if not isinstance(parsed, dict):
        return AgentIntentResult(mode="agent_chat", confidence=0.0, reason="路由 JSON 无效")

    mode = str(parsed.get("mode") or "agent_chat").strip()
    if mode not in VALID_MODES:
        mode = "agent_chat"

    confidence = float(parsed.get("confidence") or 0)
    confidence = max(0.0, min(1.0, confidence))

    profile = str(parsed.get("visual_profile") or "none").strip()
    if profile not in VALID_PROFILES:
        profile = "none"

    strategy = str(parsed.get("search_strategy") or "text_primary").strip()
    if strategy not in VALID_STRATEGIES:
        strategy = "text_primary"

    recall = str(parsed.get("recall_mode") or "balanced").strip()
    if recall not in VALID_RECALL:
        recall = "balanced"

    export = str(parsed.get("export_target") or "none").strip()
    if export not in VALID_EXPORT:
        export = "none"

    criteria = str(parsed.get("search_criteria") or "").strip()
    if mode == "find_moments" and not criteria:
        criteria = text

    reason = str(parsed.get("reason") or "").strip()

    return AgentIntentResult(
        mode=mode,  # type: ignore[arg-type]
        confidence=confidence,
        search_criteria=criteria,
        visual_profile=profile,  # type: ignore[arg-type]
        search_strategy=strategy,  # type: ignore[arg-type]
        recall_mode=recall,  # type: ignore[arg-type]
        export_target=export,  # type: ignore[arg-type]
        reason=reason,
    )

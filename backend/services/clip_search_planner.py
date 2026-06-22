"""将用户自然语言转为可执行的 clip 检索规范（Task Planner）。"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

CLIP_SEARCH_PLANNER_SYSTEM = """你是视频片段检索的任务规划器。用户会用自然语言描述要在视频中找什么，你需要把它转成明确、可判定、可交给视觉模型执行的搜索规范。

只输出一个 JSON 对象（不要 markdown、不要解释）。**全部字段使用简体中文**：

{
  "target": "简短标签",
  "search_description": "要找什么：具体、可观察的中文描述",
  "positive_examples": ["应判为命中的例子1", "例子2"],
  "negative_examples": ["易混淆但应排除的例子1", "例子2"]
}

规则：
- target：2-8 字中文标签，如 打斗、哭泣、产品展示、讲解、接吻、做饭
- search_description：用中文写清楚「要找什么」，供后续每分钟/每16秒 clip 分类器直接判断；要具体、可观察，不要剧情推理、不要抽象评价
- positive_examples：3-6 条中文短语，描述应判为命中的画面/声音
- negative_examples：2-4 条中文短语，描述容易混淆但应排除的情况
- 用户说「所有/全部」只影响召回，不改变事件定义
- 若用户描述模糊，仍给出最合理的可观察定义，不要拒绝

示例：
用户：帮我找所有打斗片段
→ target: "打斗"
→ search_description: "人物发生肢体冲突，如拳打、脚踢、扭打、械斗、持械对战"
→ positive_examples: ["挥拳打人", "脚踢", "扭打在地", "持械格斗"]
→ negative_examples: ["握手", "拥抱", "跳舞", "单纯奔跑无对抗"]

用户：帮我找所有哭泣片段
→ target: "哭泣"
→ search_description: "人物哭泣、流泪、抽泣或情绪崩溃的可见表现"
→ positive_examples: ["面部有泪痕", "抽泣", "擦眼泪"]
→ negative_examples: ["大笑", "微笑", "表情平静"]"""


@dataclass
class ClipSearchSpec:
    user_query: str
    target: str = "generic"
    search_description: str = ""
    positive_examples: List[str] = field(default_factory=list)
    negative_examples: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_query": self.user_query,
            "target": self.target,
            "search_description": self.search_description,
            "positive_examples": list(self.positive_examples),
            "negative_examples": list(self.negative_examples),
        }

    def classifier_payload(self) -> Dict[str, Any]:
        """供粗扫/精扫 Gemma 使用的统一判定规范。"""
        return {
            "target": self.target,
            "search_description": self.search_description,
            "positive_examples": self.positive_examples[:8],
            "negative_examples": self.negative_examples[:6],
        }

    def display_label(self) -> str:
        desc = (self.search_description or self.user_query).strip()
        if len(desc) > 120:
            return desc[:117] + "..."
        return desc


def _normalize_examples(raw: Any, *, limit: int = 8) -> List[str]:
    if not isinstance(raw, list):
        return []
    items: List[str] = []
    for item in raw:
        text = str(item or "").strip()
        if text and text not in items:
            items.append(text)
        if len(items) >= limit:
            break
    return items


def fallback_search_spec(user_query: str) -> ClipSearchSpec:
    """Planner 失败时的最小回退：用用户原话作为描述。"""
    text = (user_query or "").strip()
    target = text[:12] if text else "通用"
    return ClipSearchSpec(
        user_query=text,
        target=target,
        search_description=text,
        positive_examples=[],
        negative_examples=[],
    )


def parse_search_spec(user_query: str, parsed: Dict[str, Any]) -> ClipSearchSpec:
    target = str(parsed.get("target") or "generic").strip()[:32] or "generic"
    description = str(
        parsed.get("search_description")
        or parsed.get("description")
        or user_query
    ).strip()
    return ClipSearchSpec(
        user_query=user_query,
        target=target,
        search_description=description,
        positive_examples=_normalize_examples(parsed.get("positive_examples")),
        negative_examples=_normalize_examples(parsed.get("negative_examples"), limit=6),
    )


def plan_clip_search(llm_manager: Any, user_query: str) -> ClipSearchSpec:
    """LLM Task Planner：用户话 → 统一搜索规范。"""
    text = (user_query or "").strip()
    if not text:
        return fallback_search_spec("")

    messages = [
        {"role": "system", "content": CLIP_SEARCH_PLANNER_SYSTEM},
        {"role": "user", "content": f"用户请求：{text}"},
    ]
    try:
        response = llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=512,
            timeout=90,
            temperature=0.2,
        )
        parsed = llm_manager.parse_json_response(response.content or "")
        if isinstance(parsed, dict):
            spec = parse_search_spec(text, parsed)
            if spec.search_description:
                return spec
    except Exception as exc:
        logger.warning("clip 检索规划失败，回退用户原话: %s", exc)

    return fallback_search_spec(text)

"""口播分段脚本 LLM 生成。"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from backend.schemas.voiceover_plan import (
    DEFAULT_VOICEOVER_VOICE,
    MAX_VOICEOVER_SEGMENTS,
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
)

logger = logging.getLogger(__name__)

VOICEOVER_SCRIPT_SYSTEM = """你是短视频口播分镜编剧。用户会提供口播意图或原始文案，你需要拆成适合逐段录制、TTS 朗读与配画面的分段脚本。

只输出一个 JSON 对象（不要 markdown、不要解释）：

{
  "segments": [
    {
      "narration_text": "本段完整口播文案",
      "visual_brief": "画面描述：景别、主体、动作、情绪、环境",
      "search_queries": ["素材搜索词1", "素材搜索词2"]
    }
  ]
}

规则：
- 每段 narration_text 是可直接朗读的完整口播，30–120 字为宜，最长不超过 280 字
- 分段数量 3–12 段（内容少可 2 段，绝不超过 24 段）
- visual_brief 要具体可检索，避免抽象空话
- search_queries 1–3 个，适合 YouTube/Bilibili 搜 B-roll（中文或英文均可）
- 保持叙事顺序；不要输出段号字段，顺序即分段顺序
- 若用户给的是完整文稿，按语义与节奏拆分，不要擅自删改核心信息"""


def _parse_segments(raw: Any) -> List[VoiceoverSegment]:
    if not isinstance(raw, dict):
        raise ValueError("LLM 返回的不是 JSON 对象")
    rows = raw.get("segments")
    if not isinstance(rows, list) or not rows:
        raise ValueError("segments 为空或格式错误")
    if len(rows) > MAX_VOICEOVER_SEGMENTS:
        raise ValueError(f"分段超过上限 {MAX_VOICEOVER_SEGMENTS}")

    segments: List[VoiceoverSegment] = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        narration = str(row.get("narration_text") or "").strip()
        if not narration:
            continue
        visual = str(row.get("visual_brief") or "").strip()
        queries_raw = row.get("search_queries")
        queries: List[str] = []
        if isinstance(queries_raw, list):
            queries = [str(q).strip() for q in queries_raw if str(q).strip()]
        segments.append(
            VoiceoverSegment(
                id=f"vo-seg-{uuid.uuid4().hex[:12]}",
                index=index,
                narration_text=narration,
                visual_brief=visual,
                search_queries=queries,
                status=VoiceoverSegmentStatus.DRAFT,
            )
        )

    if not segments:
        raise ValueError("未解析到有效口播分段")
    for idx, seg in enumerate(segments, start=1):
        seg.index = idx
    return segments


def generate_voiceover_plan(
    llm_manager: Any,
    user_brief: str,
    *,
    voice_id: Optional[str] = None,
    speech_rate: str = "+0%",
    existing_plan: Optional[VoiceoverPlan] = None,
) -> VoiceoverPlan:
    brief = (user_brief or "").strip()
    if not brief:
        raise ValueError("user_brief 不能为空")

    messages = [
        {"role": "system", "content": VOICEOVER_SCRIPT_SYSTEM},
        {
            "role": "user",
            "content": (
                f"口播意图/原文：\n{brief}\n\n"
                "请拆分为分段脚本 JSON。"
            ),
        },
    ]
    response = llm_manager.complete_messages(
        messages,
        think=False,
        num_predict=4096,
        timeout=180,
        temperature=0.35,
    )
    content = (response.content or "").strip()
    if not content:
        raise ValueError("LLM 返回空内容，请检查模型/API 配置或 Ollama 是否运行")
    parsed = llm_manager.parse_json_response(content)
    segments = _parse_segments(parsed)

    plan_id = existing_plan.id if existing_plan else f"vo-plan-{uuid.uuid4().hex[:12]}"
    return VoiceoverPlan(
        id=plan_id,
        status=VoiceoverPlanStatus.DRAFT,
        voice_id=(voice_id or (existing_plan.voice_id if existing_plan else None) or DEFAULT_VOICEOVER_VOICE),
        speech_rate=speech_rate or (existing_plan.speech_rate if existing_plan else "+0%"),
        user_brief=brief,
        segments=segments,
    )


def regenerate_voiceover_segment(
    llm_manager: Any,
    plan: VoiceoverPlan,
    segment_id: str,
    instruction: Optional[str] = None,
) -> VoiceoverSegment:
    target = next((seg for seg in plan.segments if seg.id == segment_id), None)
    if target is None:
        raise ValueError(f"分段不存在: {segment_id}")

    context_lines = [
        f"当前分段 index={target.index}",
        f"口播：{target.narration_text}",
        f"画面：{target.visual_brief}",
    ]
    if instruction and instruction.strip():
        context_lines.append(f"修改要求：{instruction.strip()}")

    messages = [
        {"role": "system", "content": VOICEOVER_SCRIPT_SYSTEM},
        {
            "role": "user",
            "content": (
                "请只重写这一段，输出 JSON 格式与系统说明一致，但 segments 数组只含 1 项。\n\n"
                + "\n".join(context_lines)
            ),
        },
    ]
    response = llm_manager.complete_messages(
        messages,
        think=False,
        num_predict=1536,
        timeout=120,
        temperature=0.35,
    )
    content = (response.content or "").strip()
    if not content:
        raise ValueError("LLM 返回空内容，请检查模型/API 配置或 Ollama 是否运行")
    parsed = llm_manager.parse_json_response(content)
    new_segments = _parse_segments(parsed)
    updated = new_segments[0]
    updated.id = target.id
    updated.index = target.index
    updated.status = VoiceoverSegmentStatus.DRAFT
    return updated


SEARCH_QUERY_LANGUAGE_LABELS = {
    "zh": "简体中文",
    "en": "英语",
    "ja": "日语",
    "ko": "韩语",
}

SEARCH_QUERY_TRANSLATE_SYSTEM = """你是短视频 B-roll 素材搜索词翻译助手。
用户会提供若干条素材搜索关键词（每行一条），请逐条翻译为目标语言，保持简短、适合在 YouTube/Bilibili 搜索。

只输出 JSON 对象（不要 markdown、不要解释）：
{"queries": ["翻译后的搜索词1", "翻译后的搜索词2"]}

规则：
- 输出条数与输入一致，顺序不变
- 每条 2–8 个词为宜，保留检索意图（景别、主体、场景）
- 专有名词可音译或保留英文，以平台搜索习惯为准"""


def translate_search_queries(
    llm_manager: Any,
    queries: List[str],
    target_language: str,
) -> List[str]:
    cleaned = [str(item or "").strip() for item in queries if str(item or "").strip()]
    if not cleaned:
        raise ValueError("请先填写素材搜索词")

    lang = (target_language or "").strip().lower()
    label = SEARCH_QUERY_LANGUAGE_LABELS.get(lang)
    if not label:
        raise ValueError(f"不支持的目标语言: {target_language}")

    messages = [
        {"role": "system", "content": SEARCH_QUERY_TRANSLATE_SYSTEM},
        {
            "role": "user",
            "content": (
                f"目标语言：{label}\n"
                f"搜索词列表：\n{json.dumps(cleaned, ensure_ascii=False)}\n\n"
                "请翻译并输出 JSON。"
            ),
        },
    ]
    response = llm_manager.complete_messages(
        messages,
        think=False,
        num_predict=1024,
        timeout=90,
        temperature=0.2,
    )
    content = (response.content or "").strip()
    if not content:
        raise ValueError("LLM 返回空内容，请检查模型/API 配置")
    parsed = llm_manager.parse_json_response(content)
    if not isinstance(parsed, dict):
        raise ValueError("LLM 返回格式错误")
    rows = parsed.get("queries")
    if not isinstance(rows, list) or not rows:
        raise ValueError("LLM 未返回有效 queries 列表")

    translated: List[str] = []
    for index, row in enumerate(rows):
        text = str(row or "").strip()
        if not text:
            text = cleaned[index] if index < len(cleaned) else ""
        if text and text not in translated:
            translated.append(text)
    if not translated:
        raise ValueError("翻译结果为空")
    return translated[:8]

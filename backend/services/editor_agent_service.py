"""剪辑 Agent 服务（Phase A 排版分析 + Phase B 工具对话）。"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from backend.core.llm_manager import LLMManager, get_llm_manager
from backend.schemas.editor_agent import (
    AgentChatRequest,
    AgentChatResponse,
    AgentToolCall,
    AnalyzeLayoutRequest,
    AnalyzeLayoutResponse,
    LayoutAnalysis,
)
from backend.services.editor_agent_tools import (
    EDITOR_AGENT_TOOL_DEFINITIONS,
    validate_tool_calls,
)

logger = logging.getLogger(__name__)

ANALYZE_LAYOUT_SYSTEM = """你是短视频排版分析助手。用户会提供参考截图和文字说明。
请根据图片分析排版意图，只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字）。

Schema 字段：
- layout_intent: 一句话描述整体排版
- canvas_hint: { aspect, notes } 可选
- elements: 数组，每项为一块「文本」层（role 固定写 "text"，不要用 headline/subtitle/emphasis 等标题语义）
  含 content_hint、transform（positionX/Y、scaleX/Y、rotate）、
  fontSize、fontFamily、color、fontWeight、textAlign、lineHeight、background
- video_framing: notes、suggested_position_x/y、suggested_scale_x/y

坐标以画布中心为原点，Y 向上为正。positionX/positionY 与编辑器 transform 一致。
层次靠 transform 与 fontSize/color 区分，不靠 role 命名。"""

DEFAULT_ANALYZE_PROMPT = (
    "请分析这张参考图中的文字排版与画面构图，输出 LayoutAnalysis JSON。"
)

AGENT_EXECUTE_SYSTEM = """你是 AutoClip 剪辑助手。只能通过 tools 修改时间线；禁止臆造 block_id / overlay_id。

规则（必须遵守）：
1. 文案 A1：add_text_overlay / update_overlay_params 的 content 只能来自 snapshot.draft_texts 或 get_block_detail 读到的草稿内容；禁止抄 layout_reference 或参考图上的文字。
2. 排版：layout_reference 只提供位置、字号、颜色、对齐、动画等样式；elements[].role 均为 text。
3. 视频 F1：若 layout_reference.video_framing 存在，对主轨片段调用 set_video_transform。
4. 动画 C2：未指定时 add_text_overlay 使用 animation_in_type=fade、animation_in_duration=0.3。
5. 先按需调用只读工具了解草稿；再输出写工具。若无写操作，用自然语言回复。

snapshot 与 layout_reference 由用户在请求中提供。"""


class EditorAgentService:
    def __init__(self, llm_manager: Optional[LLMManager] = None):
        self.llm_manager = llm_manager or get_llm_manager()

    def analyze_layout(self, request: AnalyzeLayoutRequest) -> AnalyzeLayoutResponse:
        user_content = (request.prompt or "").strip() or DEFAULT_ANALYZE_PROMPT
        image_b64 = request.image_base64.strip()
        if not image_b64:
            raise ValueError("参考图不能为空")

        messages = [
            {"role": "system", "content": ANALYZE_LAYOUT_SYSTEM},
            {"role": "user", "content": user_content, "images": [image_b64]},
        ]

        response = self.llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=4096,
            timeout=300,
        )

        layout = self._parse_layout_analysis(response.content)
        summary = (layout.layout_intent or "").strip() or "排版分析完成"

        return AnalyzeLayoutResponse(
            layout=layout,
            summary=summary,
            raw_content=response.content,
            model=response.model,
            usage=response.usage,
        )

    def _parse_layout_analysis(self, raw_content: str) -> LayoutAnalysis:
        parsed = self.llm_manager.parse_json_response(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("模型返回的不是 JSON 对象")
        try:
            return LayoutAnalysis.model_validate(parsed)
        except ValidationError as exc:
            logger.warning("LayoutAnalysis 校验失败: %s", exc)
            raise ValueError(f"排版分析 JSON 不符合 schema: {exc}") from exc

    def chat(self, request: AgentChatRequest) -> AgentChatResponse:
        messages: List[Dict[str, Any]] = [{"role": "system", "content": AGENT_EXECUTE_SYSTEM}]

        context_parts: List[str] = []
        if request.snapshot:
            context_parts.append(
                "EditorSnapshot JSON:\n" + json.dumps(request.snapshot, ensure_ascii=False)
            )
        if request.layout_reference:
            context_parts.append(
                "LayoutReference JSON:\n"
                + json.dumps(request.layout_reference.model_dump(), ensure_ascii=False)
            )
        if context_parts:
            messages.append({"role": "system", "content": "\n\n".join(context_parts)})

        for msg in request.messages:
            item: Dict[str, Any] = {"role": msg.role, "content": msg.content or ""}
            if msg.tool_name:
                item["tool_name"] = msg.tool_name
            if msg.images:
                item["images"] = msg.images
            messages.append(item)

        response = self.llm_manager.chat_completion(
            messages,
            think=False,
            tools=EDITOR_AGENT_TOOL_DEFINITIONS,
            num_predict=4096,
            timeout=300,
            temperature=0.3,
        )

        tool_calls = [
            AgentToolCall(name=call.name, arguments=call.arguments, id=call.id)
            for call in validate_tool_calls(
                [
                    {
                        "name": tc.name,
                        "arguments": tc.arguments,
                        "id": tc.id,
                    }
                    for tc in (response.tool_calls or [])
                ]
            )
        ]

        if not tool_calls:
            tool_calls = self._parse_actions_fallback(response.content)

        return AgentChatResponse(
            assistant_message=response.content or "",
            tool_calls=tool_calls,
            finish_reason=response.finish_reason,
            model=response.model,
            usage=response.usage,
            raw_content=response.content,
        )

    @staticmethod
    def _parse_actions_fallback(content: str) -> List[AgentToolCall]:
        if not content.strip():
            return []
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, dict):
            return []
        actions = parsed.get("actions")
        if not isinstance(actions, list):
            return []
        raw = [
            {
                "name": item.get("tool") or item.get("name"),
                "arguments": item.get("args") or item.get("arguments") or {},
            }
            for item in actions
            if isinstance(item, dict)
        ]
        try:
            return [
                AgentToolCall(name=call.name, arguments=call.arguments, id=call.id)
                for call in validate_tool_calls(raw)
            ]
        except ValueError:
            return []

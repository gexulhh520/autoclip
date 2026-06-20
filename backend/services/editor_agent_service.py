"""剪辑 Agent 服务（Phase A：排版分析）。"""
from __future__ import annotations

import logging
from typing import Any, Optional

from pydantic import ValidationError

from backend.core.llm_manager import LLMManager, get_llm_manager
from backend.schemas.editor_agent import (
    AnalyzeLayoutRequest,
    AnalyzeLayoutResponse,
    LayoutAnalysis,
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

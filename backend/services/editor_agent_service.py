"""剪辑 Agent 服务（Phase A 排版分析 + Phase B 工具对话）。"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from backend.core.llm_manager import LLMManager, get_llm_manager
from backend.schemas.editor_agent import (
    AnalyzeLayoutRequest,
    AnalyzeLayoutResponse,
    AnalyzeSubtitleFrameRequest,
    AnalyzeSubtitleFrameResponse,
    AgentChatRequest,
    AgentChatResponse,
    AgentChatDebugInfo,
    AgentToolCall,
    LayoutAnalysis,
    SubtitleFrameVerdict,
)
from backend.services.editor_agent_debug import (
    agent_debug_enabled,
    build_chat_context_report,
    classify_tool_calls,
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

ANALYZE_SUBTITLE_FRAME_SYSTEM = """你是短视频字幕安全区检查助手。用户会提供一帧预览图和字幕元数据。
只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字）。

Schema 字段：
- subtitle_visible: bool，画面中是否能看到字幕文字
- overflow: none|left|right|top|bottom|multiple，字幕是否超出画面或被裁切
- issues: string[]，简短中文问题描述
- suggested_actions: string[]，可执行建议（如减小 fontSize、textAlign=center、position 居中/靠下、左移等）
- summary: 一句话结论
- confidence: high|medium|low

重点判断：字幕是否在画面可视区域内、是否被边缘裁切、是否明显遮挡关键画面（仅简要提及）。"""

DEFAULT_SUBTITLE_FRAME_PROMPT = (
    "请检查这一帧中的字幕/文本层是否在画面安全区内，输出 SubtitleFrameVerdict JSON。"
)

AGENT_EXECUTE_SYSTEM = """你是 AutoClip 剪辑助手，帮助用户在剪辑工作台完成各类操作。

你可理解并执行的需求包括但不限于：
- 文本层：添加/修改文案、字体、颜色、位置、动画
- 视频：画面位移缩放、裁切入出点、移动到其它视频轨
- 叙事：从素材池加片、主轨排序、片段转场
- 音频：添加 BGM/SFX、调整片段原声音量与淡化
- 节奏：静音检测裁切、播放头切分、删除片段（remove_block 为危险操作）
- 包装：文本动画、批量统一样式（禁止 batch 改 content）
- 感知：verify_subtitle_in_frame 截帧并由画面分析子 Agent 返回简短 JSON（不含 JPEG）；capture_preview_frame 仅调试
- 时间线：移动播放头、了解当前草稿结构（通过只读工具）

只能通过 tools 修改时间线；禁止臆造 block_id / overlay_id。

规则（必须遵守）：
1. 文案 A1：add_text_overlay / update_overlay_params 的 content 优先来自 snapshot.draft_texts 或 get_block_detail；有 layout_reference 时禁止抄参考图文字。
2. snapshot 已含 overlays、selected_overlay_id、draft_texts、blocks 摘要。改字体/位置/字号/文案/动画，或用户反馈「超出画面/溢出预览区」时，应直接输出 update_overlay_params / set_text_animation，不要先连环调用只读工具。仅当 snapshot 无法确定 overlay_id、clip_id 或 asset_id 时才调用 list_assets / get_block_detail / get_overlay_detail。
3. 涉及加片、BGM、音效时先 list_assets 获取 clip_id / audio asset id，勿臆造 id。
4. add_audio_clip 的 asset_id 必须来自 list_assets；update_block_audio 调整的是视频片段原声，不是独立音频轨 clip。
5. 视频构图：layout_reference.video_framing 存在时应对主轨 set_video_transform。
6. 动画 C2：未指定时新文本默认 animation_in_type=fade、animation_in_duration=0.3；set_text_animation 未指定 in_type 时沿用 C2。
7. 若用户仅咨询、无需改时间线，直接自然语言回复，不要调用写工具。
8. split_block_at_playhead 前须 seek_playhead 到切分点；remove_block 须在 B1 清单中由用户确认。
9. 修改文本层样式：overlay_id 优先 snapshot.selected_overlay_id，或 overlays 的 content_preview 匹配用户描述；通常 1 次 update_overlay_params 即可。
10. 用户说「刚添加/刚刚的字幕」时优先 selected_overlay_id 或 overlays 最后一项；随机字体用 Noto Serif SC、Ma Shan Zheng、Long Cang、ZCOOL XiaoWei 等（G1 映射）。
11. 超出画面时：缩小 fontSize、textAlign=center、position 居中靠下；长文案可换行。改位置/拆字后应调用 verify_subtitle_in_frame 验证；若 overflow≠none 再 update_overlay_params 修正，最多 2 轮验证。
12. 同一轮可同时输出多个写 tool（如改文案 + 加动画），避免为每个小改动单独再跑一轮只读调研。
13. EditorSnapshot 已在每次请求附带；get_timeline_summary 回传为精简摘要，勿因缺字段重复调用只读工具。
14. 用户要「逐字出现/按字拆开/一个字一个字」：split_text_overlay_by_char，layout=horizontal。
15. 用户要「竖版/竖排/竖向排列/竖着显示」：split_text_overlay_by_char 且 layout=vertical（每字一层、自上而下居中）；勿用整层 rotate 冒充竖排。可配 in_type=fade|pop 与 stagger_sec。
16. verify_subtitle_in_frame 返回 verdict.summary 与 suggested_actions；勿要求用户提供截图，勿反复 capture_preview_frame。
17. 对话中出现写工具 role=tool 执行结果（用户已确认执行）时：必须先 verify_subtitle_in_frame，overflow≠none 再 update_overlay_params 修正，最多 2 轮验证；勿重复已成功的 split。
18. 用户需求含≥2个独立步骤（如拆字+动画+验证、加字幕+改构图+加BGM）时：必须先 submit_task_plan 列出 tasks，不要直接输出写工具；单步简单需求可直接写工具。
19. 存在 task_context 时只完成 current_task；已完成项见 completed_summaries，勿重复；完成后用自然语言简短总结，勿复述中间 tool JSON。

snapshot、layout_reference（若有）由请求附带。"""


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

    def analyze_subtitle_frame(
        self, request: AnalyzeSubtitleFrameRequest
    ) -> AnalyzeSubtitleFrameResponse:
        image_b64 = request.image_base64.strip()
        if not image_b64:
            raise ValueError("预览帧不能为空")

        hints = [item.model_dump() for item in request.overlay_hints]
        meta = {
            "time_sec": request.time_sec,
            "aspect": request.aspect,
            "canvas_width": request.canvas_width,
            "canvas_height": request.canvas_height,
            "overlay_id": request.overlay_id,
            "overlay_hints": hints,
        }
        user_content = (request.prompt or "").strip() or DEFAULT_SUBTITLE_FRAME_PROMPT
        user_content = f"Frame meta JSON:\n{json.dumps(meta, ensure_ascii=False)}\n\n{user_content}"

        messages = [
            {"role": "system", "content": ANALYZE_SUBTITLE_FRAME_SYSTEM},
            {"role": "user", "content": user_content, "images": [image_b64]},
        ]

        response = self.llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=1024,
            timeout=180,
            temperature=0.2,
        )

        verdict = self._parse_subtitle_frame_verdict(response.content or "")
        summary = (verdict.summary or "").strip() or "字幕帧分析完成"

        return AnalyzeSubtitleFrameResponse(
            verdict=verdict,
            time_sec=request.time_sec,
            frame_width=int(request.canvas_width or 0),
            frame_height=int(request.canvas_height or 0),
            model=response.model,
            usage=response.usage,
            raw_content=response.content,
        )

    def _parse_subtitle_frame_verdict(self, raw_content: str) -> SubtitleFrameVerdict:
        parsed = self.llm_manager.parse_json_response(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("模型返回的不是 JSON 对象")
        overflow = str(parsed.get("overflow") or "none").strip().lower()
        allowed_overflow = {"none", "left", "right", "top", "bottom", "multiple"}
        if overflow not in allowed_overflow:
            overflow = "multiple" if overflow else "none"
        confidence = str(parsed.get("confidence") or "medium").strip().lower()
        if confidence not in {"high", "medium", "low"}:
            confidence = "medium"
        issues = parsed.get("issues")
        actions = parsed.get("suggested_actions")
        return SubtitleFrameVerdict(
            subtitle_visible=bool(parsed.get("subtitle_visible", True)),
            overflow=overflow,
            issues=[str(item) for item in issues] if isinstance(issues, list) else [],
            suggested_actions=[str(item) for item in actions] if isinstance(actions, list) else [],
            summary=str(parsed.get("summary") or "").strip(),
            confidence=confidence,
        )

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

        if request.task_context:
            tc = request.task_context
            task_lines: List[str] = ["TaskContext（逐项执行，已完成项见摘要）:"]
            if tc.user_goal:
                task_lines.append(f"总目标: {tc.user_goal}")
            if tc.completed_summaries:
                task_lines.append("已完成摘要:")
                for item in tc.completed_summaries:
                    task_lines.append(f"- {item}")
            if tc.current_task:
                task_lines.append(
                    f"当前任务 [{tc.current_task.id}]: {tc.current_task.title}"
                )
                if tc.current_task.hint:
                    task_lines.append(f"任务提示: {tc.current_task.hint}")
            if tc.pending_tasks:
                pending = ", ".join(f"{t.id}:{t.title}" for t in tc.pending_tasks)
                task_lines.append(f"待办: {pending}")
            task_lines.append("只完成当前任务；中间 tool 细节不必写入回复。")
            messages.append({"role": "system", "content": "\n".join(task_lines)})

        for msg in request.messages:
            item: Dict[str, Any] = {"role": msg.role, "content": msg.content or ""}
            if msg.tool_name:
                item["tool_name"] = msg.tool_name
            if msg.images:
                item["images"] = msg.images
            messages.append(item)

        context_report = build_chat_context_report(
            messages,
            EDITOR_AGENT_TOOL_DEFINITIONS,
            request.snapshot,
            request.layout_reference,
        )

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

        read_names, write_names = classify_tool_calls(tool_calls)
        debug = AgentChatDebugInfo(
            **context_report,
            read_tool_names=read_names,
            write_tool_names=write_names,
        )

        usage = response.usage or {}
        logger.info(
            "Agent chat: est_prompt_tokens=%s suggested_num_ctx=%s messages=%d "
            "snapshot_chars=%d finish=%s usage=%s read_tools=%s write_tools=%s",
            debug.estimated_prompt_tokens,
            debug.suggested_num_ctx,
            debug.message_count,
            debug.snapshot_chars,
            response.finish_reason,
            usage,
            read_names,
            write_names,
        )
        if agent_debug_enabled():
            logger.info(
                "Agent chat debug detail: messages_chars=%d tool_schema_chars=%d layout_chars=%d",
                debug.messages_chars,
                debug.tool_schema_chars,
                debug.layout_reference_chars,
            )

        return AgentChatResponse(
            assistant_message=response.content or "",
            tool_calls=tool_calls,
            finish_reason=response.finish_reason,
            model=response.model,
            usage=response.usage,
            raw_content=response.content,
            debug=debug,
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

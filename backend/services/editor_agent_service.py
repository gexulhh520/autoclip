"""剪辑 Agent 服务（Phase A 排版分析 + Phase B 工具对话）。"""
from __future__ import annotations

import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Iterator, List, Optional

from pydantic import ValidationError

from backend.core.llm_manager import LLMManager, get_llm_manager
from backend.core.path_utils import get_project_directory
from backend.schemas.editor_agent import (
    AnalyzeLayoutRequest,
    AnalyzeLayoutResponse,
    AnalyzeSubtitleFrameRequest,
    AnalyzeSubtitleFrameResponse,
    AnalyzeVideoContentRequest,
    AnalyzeVideoContentResponse,
    AgentChatRequest,
    AgentChatResponse,
    AgentChatDebugInfo,
    AgentToolCall,
    ClassifyAgentIntentRequest,
    ClassifyAgentIntentResponse,
    FindBlockMomentsRequest,
    FindBlockMomentsResponse,
    MatchedMoment,
    LayoutAnalysis,
    SubtitleFrameVerdict,
    VideoContentAnalysis,
    VideoFrameObservation,
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
from backend.services.editor_moment_search import (
    search_block_moments_staged,
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

MAX_PARALLEL_VISION_CALLS = 6
MAX_AUDIO_SEGMENT_LLM = 8
MAX_AUDIO_SEGMENT_LLM_CAP = 24
MAX_FRAME_OBSERVATIONS = 96
MIN_SEGMENT_LLM_SEC = 0.2

ANALYZE_VIDEO_FRAME_SYSTEM = """你是短视频单帧画面分析助手。用户会提供视频片段中的一张预览帧及时间元数据。
只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字）。

Schema 字段：
- time_sec: number，与元数据一致
- scene_summary: 一句话描述该帧画面
- subjects: string[]，画面主体/人物/物体
- shot_type: 景别，如 close_up、medium、wide、screen 等
- scene_type: 场景类型，如 talking_head、b_roll、screen_record、product、landscape、gameplay 等
- mood_hint: 简短情绪/氛围（中文）"""

ANALYZE_AUDIO_SEGMENT_SYSTEM = """你是短视频音频节奏分析助手。用户会提供片段内某一时间段的元数据（口播/静音、起止时间、时长），不含实际音频文件。
根据时长与位置推断节奏意义与剪辑建议，不要编造具体台词。
只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字）。

Schema 字段：
- start_sec: number
- end_sec: number
- kind: speech|silence
- rhythm_note: 简短中文，描述该段在节奏上的作用
- editing_hint: 可执行的剪辑建议（如可在此静音处切分、适合保留为气口）"""

AGGREGATE_VIDEO_CONTENT_SYSTEM = """你是短视频内容汇总助手。用户会提供同一视频片段的「单帧画面观察」与「音频分段笔记」（均已由子任务分析），以及片段元数据、已有文案（若有）。
只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字）。

Schema 字段：
- summary: 一句话概括片段内容与用途（综合画面与音频节奏）
- subjects: string[]，去重合并的画面主体
- scene_types: string[]，如 talking_head、b_roll、screen_record 等
- visual_pacing: slow|medium|fast，结合画面变化与口播/停顿判断
- mood: 情绪/氛围（简短中文）
- key_moments: [{time_sec, description}]，关键画面或节奏变化（最多 5 条）
- editing_suggestions: string[]，可执行的剪辑建议
- confidence: high|medium|low
- frame_observations: 必须与输入中的 frame_observations 一致（原样复制，不要改写）

有 existing_text 时可对照画面笔记，但不要照抄长文；无 ASR 时不要编造具体台词。"""

DEFAULT_VIDEO_CONTENT_PROMPT = (
    "请综合单帧观察与音频分段笔记，输出 VideoContentAnalysis JSON。"
)

AGENT_EXECUTE_SYSTEM = """你是 AutoClip 剪辑助手，帮助用户在剪辑工作台完成各类操作。

你可理解并执行的需求包括但不限于：
- 文本层：添加/修改文案、字体、颜色、位置、动画
- 视频：画面位移缩放、裁切入出点、移动到其它视频轨
- 叙事：从素材池加片、主轨排序、片段转场
- 音频：添加 BGM/SFX、调整片段原声音量与淡化
- 节奏：静音检测裁切、播放头切分、删除片段（remove_block 为危险操作）
- 包装：文本动画、批量统一样式（禁止 batch 改 content）
- 感知：verify_subtitle_in_frame 截帧并由画面分析子 Agent 返回简短 JSON（不含 JPEG）；analyze_block_content 对片段并发单帧视觉+音频分段节奏分析后文本汇总；capture_preview_frame 仅调试
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
16. 需对多个字幕/文本层批量竖排或逐字拆分：用 split_text_overlays_by_char 一次调用；overlay_ids 必须来自 snapshot.overlays 或 task_context.known_overlays；勿对同一层重复 split，勿臆造 overlay_id。
17. verify_subtitle_in_frame 返回 verdict.summary 与 suggested_actions；勿要求用户提供截图，勿反复 capture_preview_frame。
18. 对话中出现写工具 role=tool 执行结果（用户已确认执行）时：必须先 verify_subtitle_in_frame，overflow≠none 再 update_overlay_params 修正，最多 2 轮验证；勿重复已成功的 split。
19. 用户需求含≥2个独立步骤（如拆字+动画+验证、加字幕+改构图+加BGM）时：必须先 submit_task_plan 列出 tasks，不要直接输出写工具；单步简单需求可直接写工具。
20. 存在 task_context 时只完成 current_task；已完成项见 completed_summaries，勿重复；识别 overlay_id 时直接用 known_overlays，无需另起只读调研。
21. 任务 plan 中「批量拆字/竖排多个字幕」应对应 split_text_overlays_by_char，而非多次 split_text_overlay_by_char。
22. split 时 center 默认沿用原字幕层位置；多字幕同位置时系统会自动横向错开各列。任务执行后系统会自动 verify_subtitle_in_frame；若 overflow≠none 或 issues 非空须修正间距/位置。
23. task_context 下加字幕：一次 apply_caption_template。entries[{block_id,text}]；layout=horizontal|vertical；position 用九宫格(top_center/bottom_center/center_right/top_right 等)；style/animation 可选；禁止 positionX/Y/fontSize/start_sec。
24. 改布局/「全部改为竖排或横排」：apply_caption_template 且 replace_existing=true，layout=目标；entries 含各 block_id（须来自 known_blocks，text 可省略）。勿用 split_text_overlays_by_char（已是单字层会跳过）。引擎按 block_id 绑定片段，不会错位到相邻段。
25. 纯删除字幕：clear_block_captions(block_ids) 删指定片段；clear_all_captions 删主轨全部。勿用 apply_caption_template 冒充删除。
26. 滤镜/高对比/冷暖色调：一次 set_visual_filter（整片全局生效，非 per-block）。高对比=mono_contrast；柔和单色=mono_soft；冷色=mono_cool；暖色=mono_warm；取消=none。可选列表见 snapshot.visual_filter_options；当前值 snapshot.visual_filter。勿用 set_video_transform。
27. 读工具只用于当次决策；读结果不进入下一轮上下文。跨轮次只保留写操作成败摘要（execution ledger）；当前状态以每次 EditorSnapshot 为准，勿重复 get_timeline_summary。
28. snapshot.focused_block_id / focused_block 表示用户从时间线「添加到 AI 助手」钉住的片段。用户问「这段/当前片段/这个视频多长」时优先用 focused_block（含 duration_sec、trim、timeline 位置）或 get_block_detail(focused_block_id)；修改操作若针对该片段须带对应 block_id。
29. 用户问「这段讲什么/画面内容/适合怎么剪」时：只调用一次 analyze_block_content（block_id 缺省用 focused_block_id 或 selected_block_id），禁止先连环 get_timeline_summary / get_block_detail / capture_preview_frame。该工具已含静音分段+多帧视觉分析，直接根据返回的 summary 回答用户。
30. 用户要按条件找片段（打斗/金句/哲学/共鸣/有感觉的说话等）时：调用 find_block_moments。返回 matches 后默认 export_moment_clips_to_pool（本草稿 AI 素材）；仅当用户明确要求裁到/加入时间线时才用 extract_moment_clips。禁止编造未在 matches 中的时间段。

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

    def analyze_video_content(
        self, request: AnalyzeVideoContentRequest
    ) -> AnalyzeVideoContentResponse:
        frames = [item for item in request.frames if item.image_base64.strip()]
        if not frames:
            raise ValueError("预览帧不能为空")

        block_meta = {
            "block_id": request.block_id,
            "block_title": request.block_title,
            "duration_sec": request.duration_sec,
            "timeline_start_sec": request.timeline_start_sec,
            "timeline_end_sec": request.timeline_end_sec,
            "trim": request.trim,
            "aspect": request.aspect,
            "canvas_width": request.canvas_width,
            "canvas_height": request.canvas_height,
            "existing_text": request.existing_text,
            "user_question": request.user_question,
        }

        frame_observations = self._analyze_video_frames_parallel(frames, block_meta)
        audio_segment_notes = self._analyze_audio_segments_parallel(
            request.audio_analysis, block_meta
        )

        aggregate_payload = {
            "block_meta": block_meta,
            "frame_observations": [item.model_dump() for item in frame_observations],
            "audio_segment_notes": audio_segment_notes,
            "audio_stats": self._compact_audio_stats(request.audio_analysis),
            "existing_text": request.existing_text,
            "user_question": request.user_question,
        }
        user_content = (request.prompt or "").strip() or DEFAULT_VIDEO_CONTENT_PROMPT
        if request.user_question:
            user_content = f"用户问题：{request.user_question}\n\n{user_content}"
        user_content = (
            f"汇总输入 JSON:\n{json.dumps(aggregate_payload, ensure_ascii=False)}\n\n{user_content}"
        )

        messages = [
            {"role": "system", "content": AGGREGATE_VIDEO_CONTENT_SYSTEM},
            {"role": "user", "content": user_content},
        ]

        response = self.llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=1536,
            timeout=180,
            temperature=0.25,
        )

        try:
            analysis = self._parse_video_content_analysis(
                response.content or "",
                request.sample_times_sec,
                frame_observations=frame_observations,
            )
        except ValueError as exc:
            logger.warning("视频内容汇总 JSON 解析失败，回退为局部结果合并: %s", exc)
            analysis = self._fallback_video_content_analysis(
                frame_observations,
                audio_segment_notes,
                request.audio_analysis,
            )

        return AnalyzeVideoContentResponse(
            analysis=analysis,
            block_id=request.block_id,
            model=response.model,
            usage=response.usage,
            raw_content=response.content,
        )

    def classify_intent(self, request: ClassifyAgentIntentRequest) -> ClassifyAgentIntentResponse:
        from backend.services.editor_agent_intent import classify_agent_intent

        result = classify_agent_intent(self.llm_manager, request.user_message)
        return ClassifyAgentIntentResponse(**result.model_dump())

    def find_block_moments(
        self,
        request: FindBlockMomentsRequest,
        block: Dict[str, Any],
        session_id: str,
        project_id: str,
    ) -> FindBlockMomentsResponse:
        criteria = (request.search_criteria or "").strip()
        if not criteria:
            raise ValueError("search_criteria 不能为空")

        max_cap = 48 if str(request.recall_mode or "balanced") == "high" else 24
        default_results = 24 if max_cap == 48 else 12
        max_results = max(1, min(max_cap, int(request.max_results or default_results)))
        duration = request.duration_sec
        if duration <= 0 and request.timeline_end_sec > request.timeline_start_sec:
            duration = request.timeline_end_sec - request.timeline_start_sec
        if duration <= 0:
            trim = block.get("trim") or {}
            duration = float(trim.get("out_sec") or 0) - float(trim.get("in_sec") or 0)
        timeline_start = float(request.timeline_start_sec or 0)
        duration = max(duration, 0.1)

        frame_dicts = [
            {"time_sec": float(f.time_sec), "image_base64": f.image_base64.strip()}
            for f in request.frames
            if f.image_base64.strip()
        ]
        staged = search_block_moments_staged(
            self.llm_manager,
            project_id,
            session_id,
            block,
            criteria,
            timeline_start,
            duration,
            max_results,
            client_sample_times_sec=list(request.sample_times_sec or []),
            client_frames=frame_dicts or None,
            recall_mode=str(request.recall_mode or "balanced"),
            visual_profile=str(request.visual_profile).strip() if request.visual_profile else None,
            search_strategy_override=(
                request.search_strategy
                if request.search_strategy in ("visual_primary", "text_primary")
                else (
                    "visual_primary"
                    if request.visual_profile and request.visual_profile != "none"
                    else None
                )
            ),
        )

        return FindBlockMomentsResponse(
            block_id=request.block_id,
            search_criteria=criteria,
            transcript_source=staged.transcript_source,
            transcript_segment_count=staged.transcript_segment_count,
            visual_frame_count=staged.visual_frame_count,
            matches=[
                MatchedMoment(
                    start_sec=m.start_sec,
                    end_sec=m.end_sec,
                    timeline_start_sec=m.timeline_start_sec,
                    timeline_end_sec=m.timeline_end_sec,
                    trim_in_sec=m.trim_in_sec,
                    trim_out_sec=m.trim_out_sec,
                    text_preview=m.text_preview,
                    match_score=m.match_score,
                    match_reason=m.match_reason,
                    transcript_source=m.transcript_source,
                )
                for m in staged.matches
            ],
            note="；".join(staged.note_parts),
        )

    def iter_find_block_moments_stream(
        self,
        request: FindBlockMomentsRequest,
        block: Dict[str, Any],
        session_id: str,
        project_id: str,
    ) -> Iterator[str]:
        """NDJSON 流：逐窗 clip 分类并渐进输出 matches（visual_primary）。"""
        criteria = (request.search_criteria or "").strip()
        if not criteria:
            raise ValueError("search_criteria 不能为空")

        from backend.services.editor_moment_search import resolve_search_strategy
        from backend.services.clip_event_detector import iter_clip_event_search

        max_cap = 48 if str(request.recall_mode or "balanced") == "high" else 24
        default_results = 24 if max_cap == 48 else 12
        max_results = max(1, min(max_cap, int(request.max_results or default_results)))
        duration = request.duration_sec
        if duration <= 0 and request.timeline_end_sec > request.timeline_start_sec:
            duration = request.timeline_end_sec - request.timeline_start_sec
        if duration <= 0:
            trim = block.get("trim") or {}
            duration = float(trim.get("out_sec") or 0) - float(trim.get("in_sec") or 0)
        timeline_start = float(request.timeline_start_sec or 0)
        duration = max(duration, 0.1)

        strategy = request.search_strategy
        if strategy not in ("visual_primary", "text_primary"):
            if request.visual_profile and request.visual_profile != "none":
                strategy = "visual_primary"
            else:
                strategy = resolve_search_strategy(criteria)

        if strategy != "visual_primary":
            response = self.find_block_moments(
                request, block, session_id, project_id
            )
            yield json.dumps({"type": "started", "engine": "text_or_legacy", "total_windows": 1}, ensure_ascii=False) + "\n"
            yield json.dumps(
                {
                    "type": "matches",
                    "matches": [m.model_dump() for m in response.matches],
                    "windows_processed": 1,
                    "total_windows": 1,
                },
                ensure_ascii=False,
            ) + "\n"
            yield json.dumps({"type": "done", **response.model_dump()}, ensure_ascii=False) + "\n"
            return

        project_dir = get_project_directory(project_id)
        for event in iter_clip_event_search(
            self.llm_manager,
            project_dir,
            block,
            criteria,
            timeline_start,
            duration,
            max_results,
            recall_mode=str(request.recall_mode or "balanced"),
            include_audio=True,
        ):
            if event.get("type") == "done":
                event["block_id"] = request.block_id
                event["search_criteria"] = criteria
            yield json.dumps(event, ensure_ascii=False) + "\n"

    def _analyze_video_frames_parallel(
        self,
        frames: List[Any],
        block_meta: Dict[str, Any],
    ) -> List[VideoFrameObservation]:
        workers = min(MAX_PARALLEL_VISION_CALLS, len(frames))
        observations: List[VideoFrameObservation] = []

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._analyze_single_video_frame, frame, block_meta): frame
                for frame in frames
            }
            for future in as_completed(futures):
                frame = futures[future]
                try:
                    observations.append(future.result())
                except Exception as exc:
                    logger.warning(
                        "单帧分析失败 time_sec=%s: %s",
                        getattr(frame, "time_sec", "?"),
                        exc,
                    )
                    observations.append(
                        VideoFrameObservation(
                            time_sec=float(getattr(frame, "time_sec", 0) or 0),
                            scene_summary="",
                            subjects=[],
                            shot_type="",
                        )
                    )

        observations.sort(key=lambda item: item.time_sec)
        if not any(item.scene_summary.strip() for item in observations):
            raise ValueError("所有预览帧视觉分析均失败")
        return observations

    def _analyze_single_video_frame(
        self, frame: Any, block_meta: Dict[str, Any]
    ) -> VideoFrameObservation:
        meta = {
            "time_sec": frame.time_sec,
            "block_title": block_meta.get("block_title"),
            "duration_sec": block_meta.get("duration_sec"),
            "timeline_start_sec": block_meta.get("timeline_start_sec"),
            "timeline_end_sec": block_meta.get("timeline_end_sec"),
        }
        messages = [
            {"role": "system", "content": ANALYZE_VIDEO_FRAME_SYSTEM},
            {
                "role": "user",
                "content": f"Frame meta JSON:\n{json.dumps(meta, ensure_ascii=False)}\n\n描述这一帧画面。",
                "images": [frame.image_base64],
            },
        ]
        response = self.llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=384,
            timeout=120,
            temperature=0.2,
        )
        return self._parse_single_frame_observation(
            response.content or "",
            float(frame.time_sec or 0),
        )

    def _parse_single_frame_observation(
        self, raw_content: str, fallback_time: float
    ) -> VideoFrameObservation:
        parsed = self.llm_manager.parse_json_response(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("单帧分析返回的不是 JSON 对象")
        subjects = parsed.get("subjects")
        return VideoFrameObservation(
            time_sec=float(parsed.get("time_sec") or fallback_time),
            scene_summary=str(parsed.get("scene_summary") or "").strip(),
            subjects=[str(s).strip() for s in subjects] if isinstance(subjects, list) else [],
            shot_type=str(parsed.get("shot_type") or "").strip(),
        )

    def _analyze_audio_segments_parallel(
        self,
        audio_analysis: Optional[Dict[str, Any]],
        block_meta: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not audio_analysis or not isinstance(audio_analysis, dict):
            return []

        segments_raw = audio_analysis.get("segments")
        if not isinstance(segments_raw, list):
            return []

        candidates: List[Dict[str, Any]] = []
        for item in segments_raw:
            if not isinstance(item, dict):
                continue
            duration = float(item.get("duration_sec") or 0)
            if duration < MIN_SEGMENT_LLM_SEC:
                continue
            candidates.append(item)

        candidates.sort(key=lambda seg: float(seg.get("duration_sec") or 0), reverse=True)
        duration_sec = float(block_meta.get("duration_sec") or 0)
        max_segments = min(
            MAX_AUDIO_SEGMENT_LLM_CAP,
            max(MAX_AUDIO_SEGMENT_LLM, int(math.ceil(duration_sec / 300)) if duration_sec > 0 else MAX_AUDIO_SEGMENT_LLM),
        )
        selected = candidates[:max_segments]
        if not selected:
            return []

        workers = min(MAX_PARALLEL_VISION_CALLS, len(selected))
        notes: List[Dict[str, Any]] = []

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._analyze_single_audio_segment, seg, block_meta): seg
                for seg in selected
            }
            for future in as_completed(futures):
                seg = futures[future]
                try:
                    notes.append(future.result())
                except Exception as exc:
                    logger.warning(
                        "音频分段分析失败 %s–%s: %s",
                        seg.get("start_sec"),
                        seg.get("end_sec"),
                        exc,
                    )

        notes.sort(key=lambda item: float(item.get("start_sec") or 0))
        return notes

    def _analyze_single_audio_segment(
        self, segment: Dict[str, Any], block_meta: Dict[str, Any]
    ) -> Dict[str, Any]:
        meta = {
            "segment": {
                "kind": segment.get("kind"),
                "start_sec": segment.get("start_sec"),
                "end_sec": segment.get("end_sec"),
                "duration_sec": segment.get("duration_sec"),
            },
            "block_title": block_meta.get("block_title"),
            "duration_sec": block_meta.get("duration_sec"),
        }
        messages = [
            {"role": "system", "content": ANALYZE_AUDIO_SEGMENT_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Segment meta JSON:\n{json.dumps(meta, ensure_ascii=False)}\n\n"
                    "分析该时间段在口播节奏与剪辑上的意义。"
                ),
            },
        ]
        response = self.llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=256,
            timeout=90,
            temperature=0.2,
        )
        parsed = self.llm_manager.parse_json_response(response.content or "")
        if not isinstance(parsed, dict):
            raise ValueError("音频分段分析返回的不是 JSON 对象")
        return {
            "start_sec": float(parsed.get("start_sec") or segment.get("start_sec") or 0),
            "end_sec": float(parsed.get("end_sec") or segment.get("end_sec") or 0),
            "kind": str(parsed.get("kind") or segment.get("kind") or "").strip(),
            "rhythm_note": str(parsed.get("rhythm_note") or "").strip(),
            "editing_hint": str(parsed.get("editing_hint") or "").strip(),
        }

    @staticmethod
    def _compact_audio_stats(audio_analysis: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not audio_analysis or not isinstance(audio_analysis, dict):
            return None
        return {
            "silence_region_count": audio_analysis.get("silence_region_count"),
            "total_silence_sec": audio_analysis.get("total_silence_sec"),
            "speech_ratio": audio_analysis.get("speech_ratio"),
            "split_points": (audio_analysis.get("split_points") or [])[:12],
            "segment_count": len(audio_analysis.get("segments") or []),
        }

    def _fallback_video_content_analysis(
        self,
        frame_observations: List[VideoFrameObservation],
        audio_segment_notes: List[Dict[str, Any]],
        audio_analysis: Optional[Dict[str, Any]],
    ) -> VideoContentAnalysis:
        summaries = [item.scene_summary for item in frame_observations if item.scene_summary.strip()]
        subjects: List[str] = []
        scene_types: List[str] = []
        for item in frame_observations:
            for subject in item.subjects:
                if subject and subject not in subjects:
                    subjects.append(subject)
        key_moments = [
            {"time_sec": item.time_sec, "description": item.scene_summary}
            for item in frame_observations
            if item.scene_summary.strip()
        ][:5]
        editing_suggestions: List[str] = []
        for note in audio_segment_notes:
            hint = str(note.get("editing_hint") or "").strip()
            if hint:
                editing_suggestions.append(hint)
        split_points = (
            audio_analysis.get("split_points") if isinstance(audio_analysis, dict) else None
        )
        if isinstance(split_points, list) and split_points:
            editing_suggestions.append(
                f"可参考静音切分点：{', '.join(f'{float(p):.1f}s' for p in split_points[:6])}"
            )
        speech_ratio = (
            audio_analysis.get("speech_ratio") if isinstance(audio_analysis, dict) else None
        )
        summary = summaries[0] if summaries else "片段内容分析完成"
        if speech_ratio is not None:
            summary = f"{summary}（口播占比约 {int(float(speech_ratio) * 100)}%）"
        return VideoContentAnalysis(
            summary=summary,
            subjects=subjects[:8],
            scene_types=scene_types,
            visual_pacing="medium",
            mood="",
            key_moments=key_moments,
            editing_suggestions=editing_suggestions[:6],
            confidence="low",
            frame_observations=frame_observations,
        )

    def _parse_video_content_analysis(
        self,
        raw_content: str,
        sample_times: List[float],
        frame_observations: Optional[List[VideoFrameObservation]] = None,
    ) -> VideoContentAnalysis:
        parsed = self.llm_manager.parse_json_response(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("模型返回的不是 JSON 对象")

        confidence = str(parsed.get("confidence") or "medium").strip().lower()
        if confidence not in {"high", "medium", "low"}:
            confidence = "medium"
        pacing = str(parsed.get("visual_pacing") or "medium").strip().lower()
        if pacing not in {"slow", "medium", "fast"}:
            pacing = "medium"

        def _str_list(key: str) -> List[str]:
            value = parsed.get(key)
            if not isinstance(value, list):
                return []
            return [str(item).strip() for item in value if str(item).strip()]

        key_moments_raw = parsed.get("key_moments")
        key_moments: List[Dict[str, Any]] = []
        if isinstance(key_moments_raw, list):
            for item in key_moments_raw[:5]:
                if not isinstance(item, dict):
                    continue
                key_moments.append(
                    {
                        "time_sec": float(item.get("time_sec") or 0),
                        "description": str(item.get("description") or "").strip(),
                    }
                )

        frame_obs_raw = parsed.get("frame_observations")
        parsed_frame_obs: List[VideoFrameObservation] = []
        if isinstance(frame_obs_raw, list) and frame_obs_raw:
            for index, item in enumerate(frame_obs_raw[:MAX_FRAME_OBSERVATIONS]):
                if not isinstance(item, dict):
                    continue
                fallback_time = sample_times[index] if index < len(sample_times) else 0.0
                subjects = item.get("subjects")
                parsed_frame_obs.append(
                    VideoFrameObservation(
                        time_sec=float(item.get("time_sec") or fallback_time),
                        scene_summary=str(item.get("scene_summary") or "").strip(),
                        subjects=[str(s).strip() for s in subjects] if isinstance(subjects, list) else [],
                        shot_type=str(item.get("shot_type") or "").strip(),
                    )
                )
        if not parsed_frame_obs and frame_observations:
            parsed_frame_obs = frame_observations

        return VideoContentAnalysis(
            summary=str(parsed.get("summary") or "").strip(),
            subjects=_str_list("subjects"),
            scene_types=_str_list("scene_types"),
            visual_pacing=pacing,
            mood=str(parsed.get("mood") or "").strip(),
            key_moments=key_moments,
            editing_suggestions=_str_list("editing_suggestions"),
            confidence=confidence,
            frame_observations=parsed_frame_obs,
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
            if tc.known_overlays:
                task_lines.append("known_overlays（须用此 id，勿臆造）:")
                for item in tc.known_overlays:
                    oid = item.get("id", "?")
                    preview = item.get("content_preview", "")
                    chars = item.get("char_count", "?")
                    task_lines.append(f"- {oid} 「{preview}」 {chars}字")
            if tc.known_blocks:
                task_lines.append("known_blocks（每段片段 add_text_overlay 用 timeline_start_sec）:")
                for item in tc.known_blocks:
                    bid = item.get("id", "?")
                    title = item.get("title", "")
                    start = item.get("timeline_start_sec", "?")
                    dur = item.get("duration_sec", "?")
                    task_lines.append(f"- {bid} 「{title}」 start={start}s dur={dur}s")
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

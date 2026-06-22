"""剪辑 Agent 数据模型（排版分析阶段）。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class LayoutTransform(BaseModel):
    positionX: float = 0.0
    positionY: float = 0.0
    scaleX: float = 1.0
    scaleY: float = 1.0
    rotate: float = 0.0


class LayoutBackground(BaseModel):
    enabled: bool = False
    color: str = "#00000080"
    paddingX: float = 0.0
    paddingY: float = 0.0
    cornerRadius: float = 0.0


class LayoutElement(BaseModel):
    role: str = Field(
        default="text",
        description="统一为 text；不按标题/副标题/重点等语义分层",
    )
    content_hint: str = ""
    transform: LayoutTransform = Field(default_factory=LayoutTransform)
    fontSize: Optional[float] = None
    fontFamily: Optional[str] = None
    color: Optional[str] = None
    fontWeight: Optional[str] = None
    textAlign: Optional[str] = None
    lineHeight: Optional[float] = None
    background: Optional[LayoutBackground] = None


class CanvasHint(BaseModel):
    aspect: Optional[str] = None
    notes: Optional[str] = None


class VideoFraming(BaseModel):
    notes: Optional[str] = None
    suggested_position_x: float = 0.0
    suggested_position_y: float = 0.0
    suggested_scale_x: float = 1.0
    suggested_scale_y: float = 1.0


class LayoutAnalysis(BaseModel):
    layout_intent: str = ""
    canvas_hint: Optional[CanvasHint] = None
    elements: List[LayoutElement] = Field(default_factory=list)
    video_framing: Optional[VideoFraming] = None


class AnalyzeLayoutRequest(BaseModel):
    image_base64: str = Field(description="参考图 base64，可含 data URL 前缀")
    image_mime: Optional[str] = "image/png"
    prompt: str = ""


class AnalyzeLayoutResponse(BaseModel):
    layout: LayoutAnalysis
    summary: str
    raw_content: Optional[str] = None
    model: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None


class SubtitleOverlayHint(BaseModel):
    id: str = ""
    content_preview: str = ""
    start_sec: float = 0.0
    duration_sec: float = 0.0


class AnalyzeSubtitleFrameRequest(BaseModel):
    image_base64: str = Field(description="预览帧 JPEG base64，可含 data URL 前缀")
    time_sec: float = 0.0
    aspect: Optional[str] = None
    canvas_width: Optional[int] = None
    canvas_height: Optional[int] = None
    overlay_id: Optional[str] = None
    overlay_hints: List[SubtitleOverlayHint] = Field(default_factory=list)
    prompt: str = ""


class SubtitleFrameVerdict(BaseModel):
    subtitle_visible: bool = True
    overflow: str = Field(
        default="none",
        description="none|left|right|top|bottom|multiple",
    )
    issues: List[str] = Field(default_factory=list)
    suggested_actions: List[str] = Field(default_factory=list)
    summary: str = ""
    confidence: str = Field(default="medium", description="high|medium|low")


class AnalyzeSubtitleFrameResponse(BaseModel):
    verdict: SubtitleFrameVerdict
    time_sec: float = 0.0
    frame_width: int = 0
    frame_height: int = 0
    model: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    raw_content: Optional[str] = None


class AnalyzeVideoContentFrame(BaseModel):
    time_sec: float = 0.0
    image_base64: str = ""


class VideoFrameObservation(BaseModel):
    time_sec: float = 0.0
    scene_summary: str = ""
    subjects: List[str] = Field(default_factory=list)
    shot_type: str = ""


class VideoContentAnalysis(BaseModel):
    summary: str = ""
    subjects: List[str] = Field(default_factory=list)
    scene_types: List[str] = Field(default_factory=list)
    visual_pacing: str = Field(default="medium", description="slow|medium|fast")
    mood: str = ""
    key_moments: List[Dict[str, Any]] = Field(default_factory=list)
    editing_suggestions: List[str] = Field(default_factory=list)
    confidence: str = Field(default="medium", description="high|medium|low")
    frame_observations: List[VideoFrameObservation] = Field(default_factory=list)


class AnalyzeVideoContentRequest(BaseModel):
    block_id: str
    block_title: str = ""
    duration_sec: float = 0.0
    timeline_start_sec: float = 0.0
    timeline_end_sec: float = 0.0
    trim: Dict[str, float] = Field(default_factory=dict)
    sample_times_sec: List[float] = Field(default_factory=list)
    frames: List[AnalyzeVideoContentFrame] = Field(default_factory=list)
    aspect: Optional[str] = None
    canvas_width: Optional[int] = None
    canvas_height: Optional[int] = None
    audio_analysis: Optional[Dict[str, Any]] = None
    existing_text: Optional[Dict[str, str]] = None
    user_question: Optional[str] = None
    prompt: str = ""


class AnalyzeVideoContentResponse(BaseModel):
    analysis: VideoContentAnalysis
    block_id: str
    model: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    raw_content: Optional[str] = None


class MatchedMoment(BaseModel):
    start_sec: float = 0.0
    end_sec: float = 0.0
    timeline_start_sec: float = 0.0
    timeline_end_sec: float = 0.0
    trim_in_sec: float = 0.0
    trim_out_sec: float = 0.0
    text_preview: str = ""
    match_score: float = 0.0
    match_reason: str = ""
    transcript_source: str = ""


class FindBlockMomentsFrame(BaseModel):
    time_sec: float = 0.0
    image_base64: str = ""


class FindBlockMomentsRequest(BaseModel):
    block_id: str
    search_criteria: str = Field(..., min_length=1)
    max_results: int = Field(default=12, ge=1, le=48)
    recall_mode: str = Field(default="balanced", pattern="^(balanced|high)$")
    timeline_start_sec: float = 0.0
    timeline_end_sec: float = 0.0
    duration_sec: float = 0.0
    sample_times_sec: List[float] = Field(default_factory=list)
    frames: List[FindBlockMomentsFrame] = Field(default_factory=list)


class FindBlockMomentsResponse(BaseModel):
    block_id: str
    search_criteria: str
    transcript_source: str = "none"
    transcript_segment_count: int = 0
    visual_frame_count: int = 0
    matches: List[MatchedMoment] = Field(default_factory=list)
    note: str = ""


class ExportMomentClipsRequest(BaseModel):
    block_id: str
    matches: List[MatchedMoment] = Field(default_factory=list)


class ExportMomentClipsResponse(BaseModel):
    block_id: str
    created_count: int = 0
    clip_ids: List[str] = Field(default_factory=list)
    note: str = ""


class AgentChatMessage(BaseModel):
    role: str
    content: str = ""
    tool_name: Optional[str] = None
    images: Optional[List[str]] = None


class AgentToolCall(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    id: Optional[str] = None


class AgentChatDebugInfo(BaseModel):
    message_count: int = 0
    snapshot_chars: int = 0
    layout_reference_chars: int = 0
    tool_schema_chars: int = 0
    messages_chars: int = 0
    estimated_prompt_tokens: int = 0
    suggested_num_ctx: int = 0
    read_tool_names: List[str] = Field(default_factory=list)
    write_tool_names: List[str] = Field(default_factory=list)


class AgentTaskItemRef(BaseModel):
    id: str
    title: str
    hint: Optional[str] = None


class AgentTaskContext(BaseModel):
    user_goal: Optional[str] = None
    completed_summaries: List[str] = Field(default_factory=list)
    current_task: Optional[AgentTaskItemRef] = None
    pending_tasks: List[AgentTaskItemRef] = Field(default_factory=list)
    known_overlays: List[Dict[str, Any]] = Field(default_factory=list)
    known_blocks: List[Dict[str, Any]] = Field(default_factory=list)


class AgentChatRequest(BaseModel):
    messages: List[AgentChatMessage] = Field(default_factory=list)
    snapshot: Dict[str, Any] = Field(default_factory=dict)
    layout_reference: Optional[LayoutAnalysis] = None
    task_context: Optional[AgentTaskContext] = None
    max_rounds: int = Field(default=1, ge=1, le=5)


class AgentChatResponse(BaseModel):
    assistant_message: str = ""
    tool_calls: List[AgentToolCall] = Field(default_factory=list)
    finish_reason: Optional[str] = None
    model: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    raw_content: Optional[str] = None
    debug: Optional[AgentChatDebugInfo] = None

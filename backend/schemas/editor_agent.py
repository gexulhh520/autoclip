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


class AgentChatMessage(BaseModel):
    role: str
    content: str = ""
    tool_name: Optional[str] = None
    images: Optional[List[str]] = None


class AgentToolCall(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    id: Optional[str] = None


class AgentChatRequest(BaseModel):
    messages: List[AgentChatMessage] = Field(default_factory=list)
    snapshot: Dict[str, Any] = Field(default_factory=dict)
    layout_reference: Optional[LayoutAnalysis] = None
    max_rounds: int = Field(default=1, ge=1, le=5)


class AgentChatResponse(BaseModel):
    assistant_message: str = ""
    tool_calls: List[AgentToolCall] = Field(default_factory=list)
    finish_reason: Optional[str] = None
    model: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    raw_content: Optional[str] = None

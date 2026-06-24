"""口播生产线 · 分段脚本数据模型（里程碑 A）。"""
from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel, Field, field_validator

MAX_VOICEOVER_SEGMENTS = 24
DEFAULT_VOICEOVER_VOICE = "zh-CN-XiaoxiaoNeural"


class VoiceoverPlanStatus(str, Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"


class VoiceoverSegmentStatus(str, Enum):
    DRAFT = "draft"
    SCRIPT_CONFIRMED = "script_confirmed"
    TTS_DONE = "tts_done"
    BROLL_DONE = "broll_done"
    FAILED = "failed"


class VoiceoverWordTiming(BaseModel):
    text: str = ""
    start_sec: float = 0.0
    end_sec: float = 0.0


class VoiceoverTtsState(BaseModel):
    asset_id: Optional[str] = None
    audio_clip_id: Optional[str] = None
    duration_sec: Optional[float] = None
    timeline_start_sec: Optional[float] = None
    word_timings: List[VoiceoverWordTiming] = Field(default_factory=list)


class VoiceoverSubtitleState(BaseModel):
    overlay_ids: List[str] = Field(default_factory=list)
    alignment: Optional[str] = Field(default=None, description="regrouped | sentence | word")


class VoiceoverSearchResult(BaseModel):
    platform: str = ""
    title: str = ""
    url: str = ""
    external_id: Optional[str] = None
    duration_sec: Optional[float] = None
    in_library: bool = False
    library_asset_id: Optional[str] = None


class VoiceoverBrollState(BaseModel):
    search_results: List[VoiceoverSearchResult] = Field(default_factory=list)
    selected: Optional[VoiceoverSearchResult] = None
    library_asset_id: Optional[str] = None
    block_id: Optional[str] = None
    source_in_sec: Optional[float] = None
    source_out_sec: Optional[float] = None
    selection_reason: str = ""


class VoiceoverSegment(BaseModel):
    id: str
    index: int = Field(ge=1, le=MAX_VOICEOVER_SEGMENTS)
    narration_text: str = Field(min_length=1, max_length=4000)
    visual_brief: str = Field(default="", max_length=2000)
    search_queries: List[str] = Field(default_factory=list, max_length=8)
    status: VoiceoverSegmentStatus = VoiceoverSegmentStatus.DRAFT
    tts: VoiceoverTtsState = Field(default_factory=VoiceoverTtsState)
    subtitles: VoiceoverSubtitleState = Field(default_factory=VoiceoverSubtitleState)
    broll: VoiceoverBrollState = Field(default_factory=VoiceoverBrollState)
    error: Optional[str] = None

    @field_validator("search_queries")
    @classmethod
    def normalize_queries(cls, value: List[str]) -> List[str]:
        cleaned: List[str] = []
        for item in value:
            text = str(item or "").strip()
            if text and text not in cleaned:
                cleaned.append(text)
        return cleaned[:8]


class VoiceoverPlan(BaseModel):
    id: str
    status: VoiceoverPlanStatus = VoiceoverPlanStatus.DRAFT
    voice_id: str = DEFAULT_VOICEOVER_VOICE
    speech_rate: str = "+0%"
    user_brief: str = ""
    placeholder_library_asset_id: Optional[str] = None
    segments: List[VoiceoverSegment] = Field(default_factory=list, max_length=MAX_VOICEOVER_SEGMENTS)

    @field_validator("segments")
    @classmethod
    def validate_segment_count(cls, value: List[VoiceoverSegment]) -> List[VoiceoverSegment]:
        if len(value) > MAX_VOICEOVER_SEGMENTS:
            raise ValueError(f"口播分段最多 {MAX_VOICEOVER_SEGMENTS} 段")
        return value


class VoiceoverGenerateRequest(BaseModel):
    user_brief: str = Field(min_length=1, max_length=12000)
    voice_id: Optional[str] = None
    speech_rate: str = "+0%"
    replace_existing: bool = False


class VoiceoverUpdatePlanRequest(BaseModel):
    plan: VoiceoverPlan


class VoiceoverRegenerateSegmentRequest(BaseModel):
    segment_id: str = Field(min_length=1)
    instruction: Optional[str] = Field(default=None, max_length=2000)


class VoiceoverPlanResponse(BaseModel):
    session: "EditSession"
    plan: Optional[VoiceoverPlan] = None


class VoiceoverGenerateResponse(BaseModel):
    session: "EditSession"
    plan: VoiceoverPlan
    note: str = ""


class VoiceoverExecuteRequest(BaseModel):
    placeholder_library_asset_id: Optional[str] = None
    segment_ids: Optional[List[str]] = Field(default=None, max_length=MAX_VOICEOVER_SEGMENTS)


class VoiceoverExecuteResponse(BaseModel):
    session: "EditSession"
    plan: VoiceoverPlan
    note: str = ""


class VoiceoverSearchMaterialsRequest(BaseModel):
    platform: str = Field(default="youtube", description="youtube | bilibili")
    limit: int = Field(default=10, ge=1, le=20)


class VoiceoverSelectMaterialRequest(BaseModel):
    library_asset_id: Optional[str] = None
    search_result: Optional[VoiceoverSearchResult] = None
    search_result_index: Optional[int] = Field(default=None, ge=0, le=19)


class VoiceoverApplyBrollRequest(BaseModel):
    source_in_sec: Optional[float] = Field(default=None, ge=0)
    source_out_sec: Optional[float] = Field(default=None, ge=0)
    wait_download_timeout_sec: float = Field(default=180.0, ge=10.0, le=600.0)


if TYPE_CHECKING:
    from backend.schemas.edit_session import EditSession

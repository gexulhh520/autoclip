"""剪辑工程 EditSession 数据模型。"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class EditBlockMedia(BaseModel):
    type: Literal["step6_clip", "source_range", "imported_clip"] = "step6_clip"
    path: str = Field(description="相对 project 目录的 mp4 路径")
    source_video_path: Optional[str] = None
    source_start_sec: Optional[float] = None
    source_end_sec: Optional[float] = None


class EditBlockOverlay(BaseModel):
    outline: str = ""
    content: List[str] = Field(default_factory=list)
    recommend_reason: str = ""


class EditBlockAudio(BaseModel):
    volume: float = 1.0
    fade_in_sec: float = 0.0
    fade_out_sec: float = 0.0


class EditBlockTrim(BaseModel):
    in_sec: float = 0.0
    out_sec: float = 0.0


class EditBlock(BaseModel):
    id: str
    source_clip_id: str
    title: str = ""
    media: EditBlockMedia
    trim: EditBlockTrim
    overlay: EditBlockOverlay = Field(default_factory=EditBlockOverlay)
    audio: EditBlockAudio = Field(default_factory=EditBlockAudio)
    transition_out: Literal["cut", "dissolve"] = "cut"
    duration_sec: float = 0.0
    playback_rate: float = 1.0

    @model_validator(mode="after")
    def normalize_playback_rate(self) -> "EditBlock":
        self.playback_rate = max(0.25, min(4.0, float(self.playback_rate or 1.0)))
        return self


class EditOverlayElement(BaseModel):
    id: str
    type: Literal["text", "sticker"] = "text"
    start_sec: float = 0.0
    duration_sec: float = 3.0
    hidden: bool = False
    params: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_overlay(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if data.get("params"):
            return data
        if "content" not in data and "font_size" not in data:
            return {**data, "params": data.get("params") or {}}

        transform = data.get("transform") or {}
        if isinstance(transform, dict):
            pos_x = float(transform.get("x", 0.5))
            pos_y = float(transform.get("y", 0.82))
            scale = float(transform.get("scale", 1.0))
            rotate = float(transform.get("rotation", 0.0))
        else:
            pos_x, pos_y, scale, rotate = 0.5, 0.82, 1.0, 0.0

        font_size = int(data.get("font_size") or 15)
        if font_size >= 18:
            font_size = max(5, round((font_size * 90) / 1080))

        font_map = {
            "pingfang": "PingFang SC",
            "microsoft-yahei": "Microsoft YaHei",
            "noto-sc": "Noto Sans SC",
        }
        font_family = font_map.get(str(data.get("font_family") or "noto-sc"), "Noto Sans SC")
        background = data.get("background") or {}
        canvas_width = 608.0
        canvas_height = 1080.0

        params: Dict[str, Any] = {
            "content": str(data.get("content") or "新文本"),
            "fontSize": font_size,
            "fontFamily": font_family,
            "color": str(data.get("color") or "#ffffff"),
            "fontWeight": "bold" if data.get("bold") else "normal",
            "fontStyle": "italic" if data.get("italic") else "normal",
            "textDecoration": "underline" if data.get("underline") else str(data.get("text_decoration") or "none"),
            "textAlign": str(data.get("text_align") or "center"),
            "letterSpacing": float(data.get("letter_spacing") or 0.0),
            "lineHeight": float(data.get("line_height") or 1.2),
            "opacity": float(data.get("opacity") or 1.0),
            "background.enabled": bool(background.get("enabled") if isinstance(background, dict) else False),
            "background.color": str(background.get("color") if isinstance(background, dict) else "#000000"),
            "background.cornerRadius": int(background.get("corner_radius") if isinstance(background, dict) else 0),
            "background.paddingX": int(background.get("padding_x") if isinstance(background, dict) else 30),
            "background.paddingY": int(background.get("padding_y") if isinstance(background, dict) else 42),
            "background.offsetX": 0,
            "background.offsetY": 0,
            "transform.positionX": pos_x * canvas_width - canvas_width / 2,
            "transform.positionY": pos_y * canvas_height - canvas_height / 2,
            "transform.scaleX": scale,
            "transform.scaleY": scale,
            "transform.rotate": rotate,
        }

        return {
            "id": data.get("id"),
            "type": data.get("type", "text"),
            "start_sec": data.get("start_sec", 0.0),
            "duration_sec": data.get("duration_sec", 3.0),
            "hidden": data.get("hidden", False),
            "params": params,
        }


class TimelineBookmark(BaseModel):
    id: str
    time_sec: float = 0.0
    label: str = ""


EditAspectPreset = Literal[
    "original",
    "custom",
    "16:9",
    "4:3",
    "2.35:1",
    "2:1",
    "1.85:1",
    "9:16",
    "3:4",
    "5.8",
    "1:1",
    "1:2",
]


class EditExportSettings(BaseModel):
    aspect: EditAspectPreset = "9:16"
    height: int = 1080
    custom_width: Optional[int] = None
    custom_height: Optional[int] = None
    fps: int = 30
    visual_filter: Literal["none", "mono_soft", "mono_contrast", "mono_cool", "mono_warm"] = "none"
    fit_mode: Literal["contain", "cover", "contain_blur"] = "contain"

    @model_validator(mode="after")
    def normalize_fit_mode(self) -> "EditExportSettings":
        # 导出与预览统一：默认不放大裁切，保持原片比例适配画布
        if self.fit_mode == "cover":
            self.fit_mode = "contain"
        return self


class EditSessionAudioSettings(BaseModel):
    bgm_path: Optional[str] = None
    bgm_volume: float = 0.28
    fade_in_sec: float = 0.3
    fade_out_sec: float = 0.3
    bgm_start_sec: Optional[float] = None
    bgm_end_sec: Optional[float] = None
    bgm_duck_enabled: bool = True
    bgm_duck_ratio: float = 8.0
    use_source_video: bool = True
    transition_duration_sec: float = 0.35


class EditSession(BaseModel):
    schema_version: int = 1
    id: str
    project_id: str
    name: str = "未命名剪辑"
    template_id: Optional[str] = None
    template_version: Optional[str] = None
    overlay_snapshot: Dict[str, Any] = Field(default_factory=dict)
    sequence: List[EditBlock] = Field(default_factory=list)
    overlay_elements: List[EditOverlayElement] = Field(default_factory=list)
    bookmarks: List[TimelineBookmark] = Field(default_factory=list)
    export_settings: EditExportSettings = Field(default_factory=EditExportSettings)
    audio_settings: EditSessionAudioSettings = Field(default_factory=EditSessionAudioSettings)
    created_at: str
    updated_at: str


class EditSessionAppendRequest(BaseModel):
    clip_ids: List[str] = Field(min_length=1)
    source_id: Optional[str] = None


class EditSessionAppendResponse(BaseModel):
    session: EditSession
    added_count: int


class EditSessionImportMediaResponse(BaseModel):
    session: EditSession
    block_id: str
    title: str
    duration_sec: float


class EditSessionCreateRequest(BaseModel):
    clip_ids: List[str] = Field(min_length=1)
    name: Optional[str] = None
    source_id: Optional[str] = None


class EditSessionUpdateRequest(BaseModel):
    name: Optional[str] = None
    sequence: Optional[List[EditBlock]] = None
    overlay_elements: Optional[List[EditOverlayElement]] = None
    bookmarks: Optional[List[TimelineBookmark]] = None
    export_settings: Optional[EditExportSettings] = None
    audio_settings: Optional[EditSessionAudioSettings] = None


class EditSessionListResponse(BaseModel):
    sessions: List[EditSession]


class EditSessionCreateResponse(BaseModel):
    session: EditSession


class EditSessionBlankCreateResponse(BaseModel):
    session: EditSession


class EditSessionExportRequest(BaseModel):
    burn_subtitles: bool = True
    filename: Optional[str] = None
    export_srt: bool = False
    use_source_video: Optional[bool] = None
    async_export: bool = True
    write_back_to_project: bool = False
    output_dir: Optional[str] = Field(default=None, description="导出完成后复制到的本地目录")


class EditSessionExportResponse(BaseModel):
    success: bool
    output_path: str
    download_url: str
    srt_path: Optional[str] = None
    srt_download_url: Optional[str] = None
    job_id: Optional[str] = None
    project_clip_path: Optional[str] = None
    local_output_path: Optional[str] = None
    local_srt_path: Optional[str] = None


class EditSessionExportJobStatusResponse(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    progress: int
    message: str
    job_type: Literal["single", "batch"] = "single"
    download_url: Optional[str] = None
    srt_download_url: Optional[str] = None
    output_path: Optional[str] = None
    srt_path: Optional[str] = None
    project_clip_path: Optional[str] = None
    local_output_path: Optional[str] = None
    local_srt_path: Optional[str] = None
    files: Optional[List["EditSessionBatchExportItem"]] = None
    error: Optional[str] = None


class EditSessionPreviewOverlayRequest(BaseModel):
    block_id: str


class EditSessionRegenerateRequest(BaseModel):
    block_id: str
    mode: Literal["outline", "content", "both"] = "both"


class EditSessionRegenerateResponse(BaseModel):
    success: bool
    outline: str
    content: List[str]
    mode: str


class EditSessionBatchExportRequest(BaseModel):
    burn_subtitles: bool = True
    export_srt: bool = False
    use_source_video: Optional[bool] = None
    async_export: bool = True
    output_dir: Optional[str] = Field(default=None, description="导出完成后复制到的本地目录")


class EditSessionBatchExportItem(BaseModel):
    block_id: str
    title: str
    output_path: str
    download_url: str
    srt_path: Optional[str] = None
    srt_download_url: Optional[str] = None
    local_output_path: Optional[str] = None
    local_srt_path: Optional[str] = None


class EditSessionBatchExportResponse(BaseModel):
    success: bool
    files: List[EditSessionBatchExportItem]
    job_id: Optional[str] = None


class EditSessionSilenceRegion(BaseModel):
    start_sec: float
    end_sec: float


class EditSessionSilenceDetectRequest(BaseModel):
    block_id: str
    noise_db: float = -35.0
    min_silence_sec: float = 0.35


class EditSessionSilenceDetectResponse(BaseModel):
    success: bool
    silence_regions: List[EditSessionSilenceRegion]
    suggested_trim: EditBlockTrim
    removed_sec: float
    split_points: List[float] = Field(default_factory=list)


class EditSessionBilibiliUploadRequest(BaseModel):
    export_filename: str = Field(description="edit_exports 目录下的导出文件名")
    account_id: int
    title: str
    description: str = ""
    tags: List[str] = Field(default_factory=list)
    partition_id: int = 36


class EditSessionBilibiliUploadResponse(BaseModel):
    success: bool
    record_id: Optional[int] = None
    message: str
    upload_status_path: Optional[str] = None

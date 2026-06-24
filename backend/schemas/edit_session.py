"""剪辑工程 EditSession 数据模型。"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from backend.schemas.voiceover_plan import VoiceoverPlan


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
    position_offset_x_pct: float = 0.0
    position_offset_y_pct: float = 0.0
    animation_in_type: Optional[str] = None
    animation_in_duration_sec: Optional[float] = None
    animation_out_type: Optional[str] = None
    animation_out_duration_sec: Optional[float] = None
    animation_loop_type: Optional[str] = None
    animation_loop_duration_sec: Optional[float] = None
    caption_suppressed: bool = False


class EditBlockAudio(BaseModel):
    volume: float = 1.0
    fade_in_sec: float = 0.0
    fade_out_sec: float = 0.0


class EditBlockTrim(BaseModel):
    in_sec: float = 0.0
    out_sec: float = 0.0


class EditBlockVideoTransform(BaseModel):
    scale_x: float = 1.0
    scale_y: float = 1.0
    position_x: float = 0.0
    position_y: float = 0.0

    @model_validator(mode="after")
    def clamp_scales(self) -> "EditBlockVideoTransform":
        self.scale_x = max(0.1, min(4.0, float(self.scale_x or 1.0)))
        self.scale_y = max(0.1, min(4.0, float(self.scale_y or 1.0)))
        return self


class EditBlock(BaseModel):
    id: str
    source_clip_id: str
    title: str = ""
    media: EditBlockMedia
    trim: EditBlockTrim
    overlay: EditBlockOverlay = Field(default_factory=EditBlockOverlay)
    audio: EditBlockAudio = Field(default_factory=EditBlockAudio)
    transition_out: Literal[
        "cut",
        "dissolve",
        "fade_black",
        "wipe_left",
        "wipe_right",
        "wipe_up",
        "wipe_down",
        "slide_left",
        "slide_right",
        "zoom",
    ] = "cut"
    duration_sec: float = 0.0
    playback_rate: float = 1.0
    video_transform: EditBlockVideoTransform = Field(default_factory=EditBlockVideoTransform)
    track_id: Optional[str] = None
    timeline_start_sec: Optional[float] = None

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
    track_id: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)

    @staticmethod
    def _legacy_int(value: Any, default: int) -> int:
        if value is None:
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _legacy_float(value: Any, default: float) -> float:
        if value is None:
            return default
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

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
            pos_x = cls._legacy_float(transform.get("x"), 0.5)
            pos_y = cls._legacy_float(transform.get("y"), 0.82)
            scale = cls._legacy_float(transform.get("scale"), 1.0)
            rotate = cls._legacy_float(transform.get("rotation"), 0.0)
        else:
            pos_x, pos_y, scale, rotate = 0.5, 0.82, 1.0, 0.0

        font_size = cls._legacy_int(data.get("font_size"), 15)
        if font_size >= 18:
            font_size = max(5, round((font_size * 90) / 1080))

        font_map = {
            "pingfang": "PingFang SC",
            "microsoft-yahei": "Microsoft YaHei",
            "noto-sc": "Noto Sans SC",
        }
        font_family = font_map.get(str(data.get("font_family") or "noto-sc"), "Noto Sans SC")
        background = data.get("background") if isinstance(data.get("background"), dict) else {}
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
            "letterSpacing": cls._legacy_float(data.get("letter_spacing"), 0.0),
            "lineHeight": cls._legacy_float(data.get("line_height"), 1.2),
            "opacity": cls._legacy_float(data.get("opacity"), 1.0),
            "background.enabled": bool(background.get("enabled")),
            "background.color": str(background.get("color") or "#000000"),
            "background.cornerRadius": cls._legacy_int(background.get("corner_radius"), 0),
            "background.paddingX": cls._legacy_int(background.get("padding_x"), 30),
            "background.paddingY": cls._legacy_int(background.get("padding_y"), 42),
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
            "start_sec": cls._legacy_float(data.get("start_sec"), 0.0),
            "duration_sec": cls._legacy_float(data.get("duration_sec"), 3.0),
            "hidden": bool(data.get("hidden", False)),
            "params": params,
        }


class TimelineBookmark(BaseModel):
    id: str
    time_sec: float = 0.0
    label: str = ""


class TextTrackMeta(BaseModel):
    id: str
    name: str = "Text"
    hidden: bool = False
    order: int = 0


class AudioTrackMeta(BaseModel):
    id: str
    name: str = "Audio"
    hidden: bool = False
    order: int = 0


class VideoTrackMeta(BaseModel):
    id: str
    name: str = "Video"
    hidden: bool = False
    order: int = 0


class AudioAssetMeta(BaseModel):
    id: str
    name: str
    path: str
    duration_sec: Optional[float] = None
    category: Optional[Literal["sfx", "bgm"]] = None


class AudioClipElement(BaseModel):
    id: str
    asset_id: str
    track_id: Optional[str] = None
    start_sec: float = 0
    duration_sec: float = 1
    trim_start_sec: Optional[float] = None
    trim_end_sec: Optional[float] = None
    volume: Optional[float] = None
    fade_in_sec: Optional[float] = None
    fade_out_sec: Optional[float] = None
    hidden: bool = False
    playback_rate: float = 1.0
    block_id: Optional[str] = None
    block_offset_sec: Optional[float] = None

    @model_validator(mode="after")
    def normalize_playback_rate(self) -> "AudioClipElement":
        self.playback_rate = max(0.25, min(4.0, float(self.playback_rate or 1.0)))
        return self


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


class EditProjectV3Payload(BaseModel):
    """EditProject v3 文档快照（与 frontend migration/v2ToV3 对齐）。"""

    schema_version: int = 3
    id: str
    project_id: str
    name: str
    fps: float = 30
    media_pool: List[Dict[str, Any]] = Field(default_factory=list)
    scenes: List[Dict[str, Any]] = Field(default_factory=list)
    export_settings: EditExportSettings = Field(default_factory=EditExportSettings)
    audio_settings: EditSessionAudioSettings = Field(default_factory=EditSessionAudioSettings)
    template_id: Optional[str] = None
    template_version: Optional[str] = None
    overlay_snapshot: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""


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
    text_tracks: List[TextTrackMeta] = Field(default_factory=list)
    video_tracks: List[VideoTrackMeta] = Field(default_factory=list)
    audio_assets: List[AudioAssetMeta] = Field(default_factory=list)
    audio_tracks: List[AudioTrackMeta] = Field(default_factory=list)
    audio_elements: List[AudioClipElement] = Field(default_factory=list)
    bookmarks: List[TimelineBookmark] = Field(default_factory=list)
    export_settings: EditExportSettings = Field(default_factory=EditExportSettings)
    audio_settings: EditSessionAudioSettings = Field(default_factory=EditSessionAudioSettings)
    voiceover_plan: Optional[VoiceoverPlan] = None
    project_v3: Optional[EditProjectV3Payload] = None
    created_at: str
    updated_at: str


class EditSessionAppendRequest(BaseModel):
    clip_ids: List[str] = Field(min_length=1)
    source_id: Optional[str] = None
    insert_index: Optional[int] = Field(
        default=None,
        description="插入到 sequence 的下标；缺省追加到末尾",
    )


class EditSessionAppendResponse(BaseModel):
    session: EditSession
    added_count: int


class EditSessionImportMediaResponse(BaseModel):
    session: EditSession
    block_id: str
    title: str
    duration_sec: float
    import_method: Optional[str] = Field(
        default=None,
        description="路径导入方式：hardlink|symlink|reference|upload",
    )


class EditSessionBlockMediaProbeResponse(BaseModel):
    duration_sec: float = 0.0
    ready: bool = False


class EditSessionImportMediaPathRequest(BaseModel):
    source_path: str = Field(min_length=1, description="本地视频绝对路径（桌面端）")
    insert_index: Optional[int] = None


class EditSessionImportLibraryAssetRequest(BaseModel):
    asset_id: str = Field(min_length=1, description="全局素材库 asset id")
    insert_index: Optional[int] = None


class EditSessionImportBgmUrlRequest(BaseModel):
    url: str = Field(min_length=1)
    platform: Optional[str] = None


class EditSessionCreateRequest(BaseModel):
    clip_ids: List[str] = Field(min_length=1)
    name: Optional[str] = None
    source_id: Optional[str] = None


class EditSessionUpdateRequest(BaseModel):
    name: Optional[str] = None
    sequence: Optional[List[EditBlock]] = None
    overlay_elements: Optional[List[EditOverlayElement]] = None
    text_tracks: Optional[List[TextTrackMeta]] = None
    video_tracks: Optional[List[VideoTrackMeta]] = None
    audio_assets: Optional[List[AudioAssetMeta]] = None
    audio_tracks: Optional[List[AudioTrackMeta]] = None
    audio_elements: Optional[List[AudioClipElement]] = None
    bookmarks: Optional[List[TimelineBookmark]] = None
    export_settings: Optional[EditExportSettings] = None
    audio_settings: Optional[EditSessionAudioSettings] = None
    schema_version: Optional[int] = None
    project_v3: Optional[EditProjectV3Payload] = None
    voiceover_plan: Optional[VoiceoverPlan] = None


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
    use_compositor_export: Optional[bool] = Field(
        default=None,
        description="桌面 Compositor 导出；None 时由客户端决定",
    )


class EditSessionCompositorMuxRequest(BaseModel):
    compositor_video_path: Optional[str] = Field(
        default=None,
        description="Compositor 导出的本地 MP4；缺省时使用工程 staging_compositor.mp4",
    )
    filename: Optional[str] = None
    use_source_video: Optional[bool] = None
    export_srt: bool = False
    write_back_to_project: bool = False
    output_dir: Optional[str] = None
    block_id: Optional[str] = Field(
        default=None,
        description="仅混流指定片段音频（批量分轨 Compositor 导出）",
    )
    compositor_duration_sec: Optional[float] = Field(
        default=None,
        description="Compositor 成片时长（秒）；WebCodecs 导出可能缺少 moov duration，由客户端传入",
    )


class EditSessionHeadlessExportRequest(BaseModel):
    """Headless Compositor 导出 — 生成 Plan 任务，由桌面工作进程消费。"""

    burn_subtitles: bool = True
    filename: Optional[str] = None
    export_srt: bool = False
    use_source_video: Optional[bool] = None
    output_dir: Optional[str] = None


class EditSessionCompositorPlanResponse(BaseModel):
    project_id: str
    session_id: str
    plan: Dict[str, Any]


class HeadlessExportJobItemResponse(BaseModel):
    job_id: str
    project_id: str
    session_id: str
    filename: str
    burn_subtitles: bool
    export_srt: bool
    use_source_video: Optional[bool] = None
    output_dir: Optional[str] = None
    plan_path: str
    status: str = "pending"
    progress: int = 0
    message: str = "等待 Compositor 工作进程"
    error: Optional[str] = None
    local_output_path: Optional[str] = None
    local_srt_path: Optional[str] = None
    updated_at: Optional[str] = None


class HeadlessExportPendingResponse(BaseModel):
    jobs: List[HeadlessExportJobItemResponse]


class HeadlessExportJobsResponse(BaseModel):
    jobs: List[HeadlessExportJobItemResponse]


class HeadlessExportProgressRequest(BaseModel):
    progress: int = Field(ge=0, le=100)
    message: str = "处理中"


class HeadlessExportCompleteRequest(BaseModel):
    output_path: str
    download_url: str
    local_output_path: Optional[str] = None
    srt_path: Optional[str] = None
    srt_download_url: Optional[str] = None
    local_srt_path: Optional[str] = None


class HeadlessExportFailRequest(BaseModel):
    error: str


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
    audio_mixed: bool = True
    audio_warning: Optional[str] = None


class EditSessionExportJobStatusResponse(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    progress: int
    message: str
    job_type: Literal["single", "batch", "headless_compositor"] = "single"
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


class EditSessionTtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: Optional[str] = Field(
        default=None,
        description="Edge TTS voice id，如 zh-CN-XiaoxiaoNeural",
    )
    rate: str = Field(default="+0%", description="语速，如 +10% / -10%")
    overlay_id: Optional[str] = None


class EditSessionTtsResponse(BaseModel):
    session: "EditSession"
    asset_id: str
    duration_sec: float
    voice: str

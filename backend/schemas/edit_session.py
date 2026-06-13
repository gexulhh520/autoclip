"""剪辑工程 EditSession 数据模型。"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class EditBlockMedia(BaseModel):
    type: Literal["step6_clip", "source_range"] = "step6_clip"
    path: str = Field(description="相对 project 目录的 mp4 路径")
    source_video_path: Optional[str] = None
    source_start_sec: Optional[float] = None
    source_end_sec: Optional[float] = None


class EditBlockOverlay(BaseModel):
    outline: str = ""
    content: List[str] = Field(default_factory=list)
    recommend_reason: str = ""
    font_size: int = 15
    bold: bool = False
    underline: bool = False
    italic: bool = False


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


class EditSessionCreateRequest(BaseModel):
    clip_ids: List[str] = Field(min_length=1)
    name: Optional[str] = None
    source_id: Optional[str] = None


class EditSessionUpdateRequest(BaseModel):
    name: Optional[str] = None
    sequence: Optional[List[EditBlock]] = None
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

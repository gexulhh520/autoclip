"""Schema v3 剪辑工程（多轨 + 媒体池）。"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from backend.schemas.edit_session import (
    EditBlock,
    EditExportSettings,
    EditSession,
    EditSessionAudioSettings,
    TimelineBookmark,
)


class MediaAsset(BaseModel):
    id: str
    source: Literal["ai_clip", "imported", "ai_generated", "extracted", "source_range"] = "ai_clip"
    path: str
    duration_sec: float = 0.0
    title: str = ""
    source_clip_id: Optional[str] = None
    source_video_path: Optional[str] = None
    source_start_sec: Optional[float] = None
    source_end_sec: Optional[float] = None


class TrackElementTransform(BaseModel):
    x: float = 0.5
    y: float = 0.82
    scale: float = 1.0
    rotation: float = 0.0


class TrackElement(BaseModel):
    id: str
    type: Literal["clip", "text", "template_caption", "audio", "sticker"] = "clip"
    asset_id: Optional[str] = None
    start_time: float = 0.0
    duration: float = 0.0
    trim_start: float = 0.0
    trim_end: float = 0.0
    transform: TrackElementTransform = Field(default_factory=TrackElementTransform)
    properties: Dict[str, Any] = Field(default_factory=dict)
    transition_out: Literal["cut", "dissolve"] = "cut"
    hidden: bool = False


class EditSceneTracks(BaseModel):
    main: List[TrackElement] = Field(default_factory=list)
    overlay: List[TrackElement] = Field(default_factory=list)
    audio: List[TrackElement] = Field(default_factory=list)


class EditScene(BaseModel):
    id: str
    name: str = "主场景"
    tracks: EditSceneTracks = Field(default_factory=EditSceneTracks)
    bookmarks: List[TimelineBookmark] = Field(default_factory=list)


class EditProjectV3(BaseModel):
    schema_version: int = 3
    id: str
    project_id: str
    name: str = "未命名剪辑"
    fps: int = 30
    media_pool: List[MediaAsset] = Field(default_factory=list)
    scenes: List[EditScene] = Field(default_factory=list)
    export_settings: EditExportSettings = Field(default_factory=EditExportSettings)
    audio_settings: EditSessionAudioSettings = Field(default_factory=EditSessionAudioSettings)
    template_id: Optional[str] = None
    template_version: Optional[str] = None
    overlay_snapshot: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


def _media_from_block(block: EditBlock) -> MediaAsset:
    source = "ai_clip"
    if block.media.type == "imported_clip":
        source = "imported"
    elif block.media.type == "source_range":
        source = "source_range"
    return MediaAsset(
        id=f"asset_{block.id}",
        source=source,
        path=block.media.path,
        duration_sec=block.duration_sec,
        title=block.title,
        source_clip_id=block.source_clip_id,
        source_video_path=block.media.source_video_path,
        source_start_sec=block.media.source_start_sec,
        source_end_sec=block.media.source_end_sec,
    )


def migrate_session_to_v3(session: EditSession) -> EditProjectV3:
    media_pool: List[MediaAsset] = []
    main_track: List[TrackElement] = []
    overlay_track: List[TrackElement] = []
    cursor = 0.0

    for block in session.sequence:
        asset = _media_from_block(block)
        media_pool.append(asset)
        duration = max(0.1, block.trim.out_sec - block.trim.in_sec or block.duration_sec)
        main_track.append(
            TrackElement(
                id=block.id,
                type="clip",
                asset_id=asset.id,
                start_time=cursor,
                duration=duration,
                trim_start=block.trim.in_sec,
                trim_end=block.trim.out_sec,
                properties={
                    "title": block.title,
                    "volume": block.audio.volume,
                    "fade_in_sec": block.audio.fade_in_sec,
                    "fade_out_sec": block.audio.fade_out_sec,
                },
                transition_out=block.transition_out,
            )
        )
        if block.overlay.outline or block.overlay.content or block.overlay.recommend_reason:
            overlay_track.append(
                TrackElement(
                    id=f"caption_{block.id}",
                    type="template_caption",
                    asset_id=asset.id,
                    start_time=cursor,
                    duration=duration,
                    properties=block.overlay.model_dump(),
                )
            )
        cursor += duration

    for element in session.overlay_elements or []:
        overlay_track.append(
            TrackElement(
                id=element.id,
                type=element.type,
                start_time=element.start_sec,
                duration=element.duration_sec,
                transform=element.transform,
                properties={
                    "content": element.content,
                    "font_size": element.font_size,
                    "color": element.color,
                    "bold": element.bold,
                    "italic": element.italic,
                },
                hidden=element.hidden,
            )
        )

    audio_track: List[TrackElement] = []
    if session.audio_settings.bgm_path:
        audio_track.append(
            TrackElement(
                id="bgm_main",
                type="audio",
                start_time=float(session.audio_settings.bgm_start_sec or 0.0),
                duration=max(0.1, cursor),
                trim_start=float(session.audio_settings.bgm_start_sec or 0.0),
                trim_end=float(session.audio_settings.bgm_end_sec or cursor),
                properties={
                    "path": session.audio_settings.bgm_path,
                    "volume": session.audio_settings.bgm_volume,
                },
            )
        )

    return EditProjectV3(
        id=session.id,
        project_id=session.project_id,
        name=session.name,
        fps=session.export_settings.fps,
        media_pool=media_pool,
        scenes=[
            EditScene(
                id=f"{session.id}_scene_0",
                tracks=EditSceneTracks(main=main_track, overlay=overlay_track, audio=audio_track),
                bookmarks=session.bookmarks or [],
            )
        ],
        export_settings=session.export_settings,
        audio_settings=session.audio_settings,
        template_id=session.template_id,
        template_version=session.template_version,
        overlay_snapshot=session.overlay_snapshot,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def normalize_session(raw: dict) -> EditSession:
    """加载 JSON 时升级到 v3 内存模型（仍保留 v2 扁平字段）。"""
    raw.setdefault("bookmarks", [])
    raw.setdefault("overlay_elements", [])
    version = int(raw.get("schema_version", 1))
    if version < 2:
        raw["schema_version"] = 2
    session = EditSession.model_validate(raw)
    if version < 3:
        project = migrate_session_to_v3(session)
        session.schema_version = 3
        session.bookmarks = project.scenes[0].bookmarks if project.scenes else []
    return session

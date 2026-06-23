"""全局素材库与外部下载任务模型。"""

from __future__ import annotations

import enum

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)

from .base import BaseModel


class MaterialAssetOrigin(str, enum.Enum):
    SESSION_POOL = "session_pool"
    EXTERNAL_DOWNLOAD = "external_download"
    LOCAL_IMPORT = "local_import"


class MaterialFileStatus(str, enum.Enum):
    READY = "ready"
    MISSING = "missing"


class MaterialDownloadStatus(str, enum.Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MaterialLibraryAsset(BaseModel):
    __tablename__ = "material_library_assets"

    title = Column(String(255), nullable=False, index=True)
    origin = Column(
        Enum(MaterialAssetOrigin),
        nullable=False,
        default=MaterialAssetOrigin.EXTERNAL_DOWNLOAD,
        index=True,
    )
    platform = Column(String(32), nullable=True, index=True)
    external_id = Column(String(128), nullable=True, index=True)
    source_url = Column(Text, nullable=True)
    video_path = Column(String(500), nullable=False)
    thumbnail_path = Column(String(500), nullable=True)
    duration_sec = Column(Integer, nullable=True)
    file_size_bytes = Column(BigInteger, nullable=True)
    uploader = Column(String(255), nullable=True)
    upload_date = Column(String(8), nullable=True)
    view_count = Column(Integer, nullable=True)
    search_query = Column(String(255), nullable=True)
    downloaded_at = Column(DateTime(timezone=True), nullable=True)
    file_status = Column(
        Enum(MaterialFileStatus),
        nullable=False,
        default=MaterialFileStatus.READY,
    )
    source_project_id = Column(String(36), nullable=True)
    source_session_id = Column(String(36), nullable=True)
    source_clip_id = Column(String(64), nullable=True)
    asset_metadata = Column(JSON, nullable=True)
    tags = Column(JSON, nullable=True)


class MaterialDownloadTask(BaseModel):
    __tablename__ = "material_download_tasks"

    status = Column(
        Enum(MaterialDownloadStatus),
        nullable=False,
        default=MaterialDownloadStatus.PENDING,
        index=True,
    )
    platform = Column(String(32), nullable=False)
    external_id = Column(String(128), nullable=True)
    source_url = Column(Text, nullable=False)
    title = Column(String(255), nullable=False)
    thumbnail_url = Column(Text, nullable=True)
    duration_sec = Column(Integer, nullable=True)
    uploader = Column(String(255), nullable=True)
    search_query = Column(String(255), nullable=True)
    progress = Column(Float, nullable=False, default=0.0)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    asset_id = Column(
        String(36),
        ForeignKey("material_library_assets.id"),
        nullable=True,
    )
    task_metadata = Column(JSON, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

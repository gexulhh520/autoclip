"""多源视频 · 单项目 — Pydantic 模型。"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class ProjectSourceStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ProjectSourceRecord(BaseModel):
    id: str
    index: int
    original_filename: str
    status: ProjectSourceStatus = ProjectSourceStatus.PENDING
    video_path: Optional[str] = None
    subtitle_path: Optional[str] = None
    duration_seconds: Optional[int] = None
    clips_count: int = 0
    error_message: Optional[str] = None
    current_step: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class MultiSourceConfig(BaseModel):
    enabled: bool = True
    current_source_index: Optional[int] = None
    sources: List[ProjectSourceRecord] = Field(default_factory=list)


class ProjectSourceSummary(BaseModel):
    id: str
    index: int
    original_filename: str
    status: ProjectSourceStatus
    clips_count: int = 0
    current_step: Optional[str] = None
    error_message: Optional[str] = None


class MultiSourceProjectSummary(BaseModel):
    enabled: bool
    total_sources: int
    completed_sources: int
    active_source_id: Optional[str] = None
    sources: List[ProjectSourceSummary] = Field(default_factory=list)


class ProjectSourcesResponse(BaseModel):
    project_id: str
    multi_source: MultiSourceProjectSummary

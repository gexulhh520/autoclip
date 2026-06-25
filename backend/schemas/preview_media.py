"""桌面端预览：本地媒体绝对路径（供 Tauri convertFileSrc）。"""
from pydantic import BaseModel, Field


class LocalMediaPathResponse(BaseModel):
    path: str = Field(description="服务器本地绝对路径")

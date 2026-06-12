"""基因模板 Pydantic 模型。"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TemplatePreview(BaseModel):
    video_url: str = ""
    thumbnail_url: str = ""


class TemplatePipelineConfig(BaseModel):
    clip_goal: str
    video_category: str = "default"
    clip_duration_preset: Optional[str] = None


class TemplatePromptsConfig(BaseModel):
    pack: Optional[str] = None
    overrides: Optional[Dict[str, str]] = None


class TemplateRulesConfig(BaseModel):
    enable_clustering: Optional[bool] = None
    subtitle_style: Optional[str] = None

    model_config = {"extra": "allow"}


class GeneTemplate(BaseModel):
    id: str
    name: str
    description: str
    version: str = "1.0.0"
    enabled: bool = True
    tags: List[str] = Field(default_factory=list)
    preview: TemplatePreview = Field(default_factory=TemplatePreview)
    pipeline: TemplatePipelineConfig
    prompts: Optional[TemplatePromptsConfig] = None
    rules: Optional[TemplateRulesConfig] = None


class GeneTemplateSummary(BaseModel):
    """列表接口：不含 rules / prompts 细节。"""

    id: str
    name: str
    description: str
    version: str
    tags: List[str]
    preview: TemplatePreview
    pipeline: TemplatePipelineConfig


class GeneTemplateListResponse(BaseModel):
    templates: List[GeneTemplateSummary]
    default_template: Optional[str] = None


class GeneTemplateDetailResponse(BaseModel):
    template: GeneTemplate
    resolved_settings: Dict[str, Any]

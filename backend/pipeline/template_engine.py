"""基因模板引擎：从 JSON 配置加载模板并解析为 Pipeline 设置。"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.pipeline.goals.registry import get_goal
from backend.schemas.template import GeneTemplate, GeneTemplateSummary

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
DEFAULT_TEMPLATE_ID = "golden_quote_cinema"


class TemplateNotFoundError(KeyError):
    """请求的 template_id 不存在或未启用。"""


class TemplateEngine:
    """加载 backend/templates/*.json，提供列表/详情与 processing_config 解析。"""

    def __init__(self, templates_dir: Optional[Path] = None) -> None:
        self.templates_dir = templates_dir or TEMPLATES_DIR

    def reload(self) -> None:
        self._load_all_templates.cache_clear()

    @lru_cache(maxsize=1)
    def _load_all_templates(self) -> Dict[str, GeneTemplate]:
        templates: Dict[str, GeneTemplate] = {}
        if not self.templates_dir.is_dir():
            logger.warning("Templates directory missing: %s", self.templates_dir)
            return templates

        for path in sorted(self.templates_dir.glob("*.json")):
            if path.name == "schema.json":
                continue
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                template = GeneTemplate.model_validate(raw)
                templates[template.id] = template
            except Exception as exc:
                logger.error("Failed to load template %s: %s", path.name, exc)
        return templates

    def list_templates(self, *, include_disabled: bool = False) -> List[GeneTemplate]:
        items = list(self._load_all_templates().values())
        if not include_disabled:
            items = [t for t in items if t.enabled]
        return sorted(items, key=lambda t: t.name)

    def get_template(self, template_id: str, *, require_enabled: bool = True) -> GeneTemplate:
        template = self._load_all_templates().get(template_id)
        if template is None:
            raise TemplateNotFoundError(template_id)
        if require_enabled and not template.enabled:
            raise TemplateNotFoundError(template_id)
        return template

    def to_summary(self, template: GeneTemplate) -> GeneTemplateSummary:
        return GeneTemplateSummary(
            id=template.id,
            name=template.name,
            description=template.description,
            version=template.version,
            tags=template.tags,
            preview=template.preview,
            pipeline=template.pipeline,
        )

    def resolve_processing_settings(
        self,
        template_id: str,
        *,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        将模板解析为可写入 Project.processing_config 的设置 dict。
        与现有 clip_goal / video_category 字段兼容。
        """
        template = self.get_template(template_id)
        goal = get_goal(template.pipeline.clip_goal)

        settings: Dict[str, Any] = {
            "template_id": template.id,
            "clip_goal": template.pipeline.clip_goal,
            "video_category": template.pipeline.video_category,
        }

        duration_preset = template.pipeline.clip_duration_preset or goal.default_duration_preset
        if duration_preset:
            settings["clip_duration_preset"] = duration_preset

        prompt_pack = (template.prompts.pack if template.prompts and template.prompts.pack else goal.prompt_pack)
        settings["prompt_pack"] = prompt_pack

        if template.rules:
            settings["template_rules"] = template.rules.model_dump(exclude_none=True)

        if template.prompts and template.prompts.overrides:
            settings["prompt_overrides"] = {
                k: v for k, v in template.prompts.overrides.items() if v
            }

        if extra:
            settings.update(extra)
        return settings


def validate_template_id(template_id: Optional[str]) -> None:
    """校验 template_id 存在且已启用；空值直接通过。"""
    if not template_id:
        return
    get_template_engine().get_template(str(template_id))


def merge_template_settings(settings: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    若 settings 含 template_id，合并 TemplateEngine 解析出的 Pipeline 配置。
    无 template_id 时原样返回，保证向后兼容。
    """
    merged = dict(settings or {})
    template_id = merged.get("template_id")
    if not template_id:
        return merged
    try:
        resolved = get_template_engine().resolve_processing_settings(str(template_id))
        merged.update(resolved)
    except TemplateNotFoundError:
        logger.warning("Unknown template_id in settings: %s", template_id)
    return merged


@lru_cache(maxsize=1)
def get_template_engine() -> TemplateEngine:
    return TemplateEngine()

"""TemplateEngine 单元测试。"""
from pathlib import Path

import pytest

from backend.pipeline.template_engine import TemplateEngine, TemplateNotFoundError, merge_template_settings
from backend.schemas.template import GeneTemplate


@pytest.fixture
def engine() -> TemplateEngine:
    templates_dir = Path(__file__).resolve().parent.parent / "templates"
    return TemplateEngine(templates_dir=templates_dir)


def test_list_templates_returns_enabled_only(engine: TemplateEngine):
    templates = engine.list_templates()
    assert len(templates) >= 2
    assert all(t.enabled for t in templates)
    ids = {t.id for t in templates}
    assert "golden_quote_cinema" in ids
    assert "knowledge_digest" in ids


def test_get_template_golden_quote_cinema(engine: TemplateEngine):
    template = engine.get_template("golden_quote_cinema")
    assert template.name == "经典影视金句"
    assert template.pipeline.clip_goal == "golden_quote"
    assert template.pipeline.video_category == "entertainment"


def test_get_template_not_found(engine: TemplateEngine):
    with pytest.raises(TemplateNotFoundError):
        engine.get_template("nonexistent_template")


def test_resolve_processing_settings(engine: TemplateEngine):
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    assert settings["template_id"] == "golden_quote_cinema"
    assert settings["clip_goal"] == "golden_quote"
    assert settings["video_category"] == "entertainment"
    assert settings["clip_duration_preset"] == "short"
    assert settings["prompt_pack"] == "golden_quote"
    assert settings["template_rules"]["enable_clustering"] is False
    assert settings["template_rules"]["subtitle_style"] == "quote_highlight"


def test_to_summary_omits_rules(engine: TemplateEngine):
    template = engine.get_template("knowledge_digest")
    summary = engine.to_summary(template)
    assert summary.id == template.id
    assert not hasattr(summary, "rules")


def test_merge_template_settings(engine: TemplateEngine):
    merged = merge_template_settings({"template_id": "golden_quote_cinema", "video_file": "a.mp4"})
    assert merged["template_id"] == "golden_quote_cinema"
    assert merged["clip_goal"] == "golden_quote"
    assert merged["video_file"] == "a.mp4"


def test_merge_template_settings_no_template_id():
    raw = {"clip_goal": "knowledge", "video_category": "default"}
    assert merge_template_settings(raw) == raw


def test_template_json_validates_against_schema(engine: TemplateEngine):
    for template in engine.list_templates(include_disabled=True):
        assert isinstance(template, GeneTemplate)
        assert template.pipeline.clip_goal

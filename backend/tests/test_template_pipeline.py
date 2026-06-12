"""基因模板 Pipeline 集成测试。"""
from pathlib import Path

import pytest

from backend.pipeline.goals.registry import GOAL_PROFILES
from backend.pipeline.pipelines.definitions import (
    TOPIC_PIPELINE_STEPS,
    apply_template_step_rules,
    resolve_effective_step_order,
)
from backend.pipeline.prompt_loader import (
    TEMPLATES_PROMPT_DIR,
    load_goal_prompt_contents,
    save_template_config_to_metadata,
)
from backend.pipeline.template_engine import TemplateEngine


def test_apply_template_step_rules_disable_clustering():
    order = apply_template_step_rules(
        TOPIC_PIPELINE_STEPS,
        {"template_rules": {"enable_clustering": False}},
    )
    assert "step5_clustering" not in order
    assert "step6_video" in order


def test_apply_template_step_rules_enable_clustering_on_moment():
    moment_steps = [
        "step1_outline",
        "step2_timeline",
        "step3_scoring",
        "step4_title",
        "step6_video",
    ]
    order = apply_template_step_rules(
        moment_steps,
        {"template_rules": {"enable_clustering": True}},
    )
    assert order.index("step5_clustering") < order.index("step6_video")


def test_resolve_effective_step_order_knowledge_digest_template():
    goal = GOAL_PROFILES["knowledge"]
    order = resolve_effective_step_order(
        goal,
        {"template_rules": {"enable_clustering": False}},
    )
    assert "step5_clustering" not in order


def test_prompt_loader_uses_template_directory(tmp_path, monkeypatch):
    template_id = "test_template_prompt"
    template_dir = tmp_path / "templates" / template_id
    template_dir.mkdir(parents=True)
    (template_dir / "大纲.txt").write_text("TEMPLATE_OUTLINE_PROMPT", encoding="utf-8")

    monkeypatch.setattr("backend.pipeline.prompt_loader.TEMPLATES_PROMPT_DIR", tmp_path / "templates")

    goal = GOAL_PROFILES["knowledge"]
    contents = load_goal_prompt_contents(
        goal,
        video_category="default",
        settings={"template_id": template_id},
    )
    assert contents["outline"] == "TEMPLATE_OUTLINE_PROMPT"


def test_prompt_loader_applies_inline_overrides():
    goal = GOAL_PROFILES["knowledge"]
    contents = load_goal_prompt_contents(
        goal,
        settings={"prompt_overrides": {"title": "INLINE_TITLE_PROMPT"}},
    )
    assert contents["title"] == "INLINE_TITLE_PROMPT"


def test_save_template_config_to_metadata(tmp_path):
    settings = {
        "template_id": "golden_quote_cinema",
        "prompt_pack": "golden_quote",
        "template_rules": {"enable_clustering": False, "subtitle_style": "default"},
    }
    save_template_config_to_metadata(tmp_path, settings)
    payload = (tmp_path / "template_config.json").read_text(encoding="utf-8")
    assert "golden_quote_cinema" in payload
    assert "subtitle_style" in payload


def test_template_engine_includes_prompt_overrides():
    engine = TemplateEngine(
        templates_dir=Path(__file__).resolve().parent.parent / "templates"
    )
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    assert settings["template_id"] == "golden_quote_cinema"
    assert "prompt_overrides" not in settings or isinstance(settings.get("prompt_overrides"), dict)


def test_prompt_loader_uses_golden_quote_cinema_template():
    engine = TemplateEngine(
        templates_dir=Path(__file__).resolve().parent.parent / "templates"
    )
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    contents = load_goal_prompt_contents(
        GOAL_PROFILES["golden_quote"],
        video_category="entertainment",
        settings=settings,
    )
    assert "影视解说" in contents.get("outline", "")

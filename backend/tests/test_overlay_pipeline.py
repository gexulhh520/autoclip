"""Overlay pipeline 单元测试。"""
import json

import pytest

from backend.pipeline.overlay_pipeline import (
    COMPOSER_NONE,
    COMPOSER_QUOTE_CINEMA,
    RENDERER_ASS_STACK,
    RENDERER_NONE,
    build_overlay_preview,
    build_overlay_snapshot,
    normalize_overlay_rules,
    resolve_overlay_pipeline,
)
from backend.pipeline.prompt_loader import save_template_config_to_metadata
from backend.pipeline.template_engine import TemplateEngine
from backend.services.pipeline_steps_service import (
    _load_project_processing_settings,
    preview_timeline_overlay,
)


@pytest.fixture
def engine() -> TemplateEngine:
    from pathlib import Path

    templates_dir = Path(__file__).resolve().parent.parent / "templates"
    return TemplateEngine(templates_dir=templates_dir)


def test_normalize_overlay_from_legacy_subtitle_style():
    rules = {
        "subtitle_style": "quote_cinema",
        "quote_overlay": {"max_headline_chars": 10},
    }
    normalized = normalize_overlay_rules(rules)
    assert normalized["composer"] == COMPOSER_QUOTE_CINEMA
    assert normalized["renderer"] == RENDERER_ASS_STACK
    assert normalized["config"]["max_headline_chars"] == 10


def test_normalize_overlay_explicit_block_overrides_legacy():
    rules = {
        "subtitle_style": "default",
        "overlay": {
            "composer": "quote_cinema",
            "renderer": "ass_stack",
        },
        "quote_overlay": {"alignment": "bottom-center"},
    }
    normalized = normalize_overlay_rules(rules)
    assert normalized["composer"] == COMPOSER_QUOTE_CINEMA
    assert normalized["config"]["alignment"] == "bottom-center"


def test_resolve_overlay_pipeline_golden_quote(engine: TemplateEngine):
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    pipeline = resolve_overlay_pipeline(settings)
    assert pipeline.composer == COMPOSER_QUOTE_CINEMA
    assert pipeline.renderer == RENDERER_ASS_STACK
    assert pipeline.subtitle_style == "quote_cinema"
    assert pipeline.template_version == settings["template_version"]
    assert pipeline.config.get("alignment") == "bottom-left"


def test_resolve_overlay_pipeline_knowledge_digest(engine: TemplateEngine):
    settings = engine.resolve_processing_settings("knowledge_digest")
    pipeline = resolve_overlay_pipeline(settings)
    assert pipeline.composer == COMPOSER_NONE
    assert pipeline.renderer == RENDERER_NONE
    assert pipeline.subtitle_style == "default"


def test_compose_and_preview_quote_cinema(engine: TemplateEngine):
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    pipeline = resolve_overlay_pipeline(settings)
    preview = build_overlay_preview(
        {"content": ["天生我才必有用", "千金散尽还复来"]},
        pipeline,
    )
    assert preview["applicable"] is True
    assert preview["layout"] == "cinema"
    assert preview["composer"] == COMPOSER_QUOTE_CINEMA
    assert preview["renderer"] == RENDERER_ASS_STACK
    roles = [layer["role"] for layer in preview["layers"]]
    assert "headline" in roles


def test_save_template_config_includes_version_and_overlay(tmp_path, engine: TemplateEngine):
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    save_template_config_to_metadata(tmp_path, settings)
    payload = json.loads((tmp_path / "template_config.json").read_text(encoding="utf-8"))
    assert payload["template_version"] == settings["template_version"]
    assert payload["overlay"]["composer"] == COMPOSER_QUOTE_CINEMA
    assert payload["overlay"]["renderer"] == RENDERER_ASS_STACK


def test_frozen_project_overlay_not_replaced_by_latest_template(tmp_path, monkeypatch):
    project_dir = tmp_path / "project"
    metadata_dir = project_dir / "metadata"
    metadata_dir.mkdir(parents=True)
    frozen_overlay = {
        "composer": "quote_cinema",
        "renderer": "ass_stack",
        "config": {"caps_label": "FROZEN_LABEL", "show_emphasis_line": True},
    }
    (metadata_dir / "template_config.json").write_text(
        json.dumps(
            {
                "template_id": "golden_quote_cinema",
                "template_version": "1.0.0",
                "template_rules": {
                    "subtitle_style": "quote_cinema",
                    "quote_overlay": {"caps_label": "FROZEN_LABEL", "show_emphasis_line": True},
                },
                "overlay": frozen_overlay,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    settings = _load_project_processing_settings(project_dir)
    pipeline = resolve_overlay_pipeline(settings)
    assert pipeline.config.get("caps_label") == "FROZEN_LABEL"
    assert pipeline.config.get("show_emphasis_line") is True


def test_preview_timeline_overlay_uses_frozen_config(tmp_path, monkeypatch):
    project_id = "overlay-frozen-preview"
    project_dir = tmp_path / "projects" / project_id
    metadata_dir = project_dir / "metadata"
    metadata_dir.mkdir(parents=True)
    (metadata_dir / "template_config.json").write_text(
        json.dumps(
            {
                "template_id": "golden_quote_cinema",
                "template_version": "1.0.0",
                "template_rules": {
                    "subtitle_style": "quote_cinema",
                    "quote_overlay": {"show_emphasis_line": True, "caps_label": "FROZEN"},
                },
                "overlay": {
                    "composer": "quote_cinema",
                    "renderer": "ass_stack",
                    "config": {"show_emphasis_line": True, "caps_label": "FROZEN"},
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.services.pipeline_steps_service.get_project_directory",
        lambda _pid: project_dir,
    )

    result = preview_timeline_overlay(
        project_id,
        {"content": ["天生我才必有用"]},
    )
    roles = [layer["role"] for layer in result["layers"]]
    assert "emphasis" in roles


def test_build_overlay_snapshot_from_settings(engine: TemplateEngine):
    settings = engine.resolve_processing_settings("golden_quote_cinema")
    snapshot = build_overlay_snapshot(settings)
    assert snapshot["composer"] == COMPOSER_QUOTE_CINEMA
    assert "color_preset" in snapshot["config"]

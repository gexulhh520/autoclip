"""Pipeline steps UI should reflect template step rules."""

from backend.services.pipeline_steps_service import (
    _effective_pipeline_step_ids,
    _resolve_template_name,
)


def test_golden_quote_skips_step5_in_effective_steps():
    ids = _effective_pipeline_step_ids({"template_id": "golden_quote_cinema"})
    assert "step5_clustering" not in ids
    assert "download" in ids
    assert "step6_video" in ids
    assert len(ids) == 6


def test_knowledge_digest_keeps_all_steps():
    ids = _effective_pipeline_step_ids({"template_id": "knowledge_digest"})
    assert "step5_clustering" in ids
    assert len(ids) == 7


def test_resolve_template_names():
    assert _resolve_template_name("golden_quote_cinema") == "经典影视金句"
    assert _resolve_template_name("knowledge_digest") == "知识干货精选"
    assert _resolve_template_name(None) is None

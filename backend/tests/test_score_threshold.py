from backend.pipeline.goals.registry import GOAL_PROFILES
from backend.pipeline.steps.runners import resolve_score_threshold


def test_resolve_score_threshold_template_rules_override():
    threshold = resolve_score_threshold(
        {
            "template_rules": {"min_score_threshold": 0.82},
            "clip_goal": "golden_quote",
        },
        GOAL_PROFILES["golden_quote"],
    )
    assert threshold == 0.82


def test_resolve_score_threshold_goal_default():
    threshold = resolve_score_threshold({"clip_goal": "golden_quote"}, GOAL_PROFILES["golden_quote"])
    assert threshold == 0.78


def test_resolve_score_threshold_global_default():
    threshold = resolve_score_threshold({"clip_goal": "knowledge"}, GOAL_PROFILES["knowledge"])
    assert threshold == 0.7

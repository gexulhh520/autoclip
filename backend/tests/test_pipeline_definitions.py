"""Pipeline 步骤组合解析测试。"""
from backend.pipeline.goals.base import GoalProfile
from backend.pipeline.goals.registry import GOAL_PROFILES
from backend.pipeline.pipelines.definitions import (
    MOMENT_PIPELINE_STEPS,
    TOPIC_PIPELINE_STEPS,
    apply_template_step_rules,
    get_pipeline_steps,
    resolve_step_order,
)


def test_get_pipeline_steps_returns_preset_without_filter():
    assert get_pipeline_steps("topic") == TOPIC_PIPELINE_STEPS
    assert get_pipeline_steps("moment") == MOMENT_PIPELINE_STEPS
    assert "step5_clustering" not in get_pipeline_steps("moment")
    assert "step5_clustering" in get_pipeline_steps("topic")


def test_resolve_step_order_from_pipeline_id():
    goal = GOAL_PROFILES["golden_quote"]
    assert resolve_step_order(goal) == MOMENT_PIPELINE_STEPS


def test_resolve_step_order_goal_step_ids_override():
    custom = GoalProfile(
        id="custom",
        name="custom",
        description="",
        pipeline_id="topic",
        prompt_pack="knowledge",
        step_ids=["step1_outline", "step6_video"],
    )
    assert resolve_step_order(custom) == ["step1_outline", "step6_video"]


def test_apply_template_step_rules_no_rules_keeps_order():
    assert apply_template_step_rules(TOPIC_PIPELINE_STEPS, {}) == TOPIC_PIPELINE_STEPS

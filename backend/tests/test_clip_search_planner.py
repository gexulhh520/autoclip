"""clip 检索 Planner 单元测试。"""
import json

from backend.services.clip_search_planner import (
    ClipSearchSpec,
    fallback_search_spec,
    parse_search_spec,
    plan_clip_search,
)


class _FakeLlm:
    def __init__(self, payload: dict):
        self.payload = payload

    def parse_json_response(self, raw: str):
        return json.loads(raw)

    def chat_completion(self, messages, **kwargs):
        class _Resp:
            content = json.dumps(self.payload, ensure_ascii=False)

        return _Resp()


def test_plan_clip_search_fight():
    llm = _FakeLlm(
        {
            "target": "fight",
            "search_description": "physical fighting, punching, kicking, combat",
            "positive_examples": ["punching", "kicking"],
            "negative_examples": ["handshake", "hugging"],
        }
    )
    spec = plan_clip_search(llm, "帮我找所有打斗片段")
    assert spec.target == "fight"
    assert "fighting" in spec.search_description
    assert "punching" in spec.positive_examples
    assert "handshake" in spec.negative_examples


def test_plan_clip_search_crying():
    llm = _FakeLlm(
        {
            "target": "crying",
            "search_description": "crying, tears, emotional breakdown",
            "positive_examples": ["tears on face"],
            "negative_examples": ["smiling"],
        }
    )
    spec = plan_clip_search(llm, "找主角哭泣的片段")
    assert spec.target == "crying"
    assert "tears" in spec.search_description


def test_fallback_search_spec():
    spec = fallback_search_spec("找产品展示")
    assert spec.user_query == "找产品展示"
    assert spec.search_description == "找产品展示"


def test_classifier_payload():
    spec = ClipSearchSpec(
        user_query="test",
        target="fight",
        search_description="combat",
        positive_examples=["a", "b"],
        negative_examples=["c"],
    )
    payload = spec.classifier_payload()
    assert payload["target"] == "fight"
    assert payload["search_description"] == "combat"
    assert len(payload["positive_examples"]) == 2

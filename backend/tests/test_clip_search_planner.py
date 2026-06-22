"""clip 检索 Planner 单元测试。"""
import json

from backend.services.clip_search_planner import (
    ClipSearchSpec,
    fallback_search_spec,
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
            "target": "打斗",
            "search_description": "人物发生肢体冲突，如拳打、脚踢、扭打",
            "positive_examples": ["挥拳打人", "脚踢"],
            "negative_examples": ["握手", "拥抱"],
        }
    )
    spec = plan_clip_search(llm, "帮我找所有打斗片段")
    assert spec.target == "打斗"
    assert "肢体冲突" in spec.search_description
    assert "挥拳打人" in spec.positive_examples
    assert "握手" in spec.negative_examples


def test_plan_clip_search_crying():
    llm = _FakeLlm(
        {
            "target": "哭泣",
            "search_description": "人物哭泣、流泪、抽泣",
            "positive_examples": ["面部有泪痕"],
            "negative_examples": ["大笑"],
        }
    )
    spec = plan_clip_search(llm, "找主角哭泣的片段")
    assert spec.target == "哭泣"
    assert "流泪" in spec.search_description


def test_fallback_search_spec():
    spec = fallback_search_spec("找产品展示")
    assert spec.user_query == "找产品展示"
    assert spec.search_description == "找产品展示"
    assert spec.target == "找产品展示"


def test_classifier_payload():
    spec = ClipSearchSpec(
        user_query="test",
        target="打斗",
        search_description="肢体冲突",
        positive_examples=["挥拳"],
        negative_examples=["握手"],
    )
    payload = spec.classifier_payload()
    assert payload["target"] == "打斗"
    assert payload["search_description"] == "肢体冲突"
    assert len(payload["positive_examples"]) == 1

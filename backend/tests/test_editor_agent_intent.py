"""LLM 意图路由单元测试。"""
import json

from backend.services.editor_agent_intent import classify_agent_intent


class _FakeLlm:
    def __init__(self, payload: dict):
        self.payload = payload

    def parse_json_response(self, raw: str):
        return json.loads(raw)

    def chat_completion(self, messages, **kwargs):
        return _Resp(json.dumps(self.payload, ensure_ascii=False))


class _Resp:
    def __init__(self, content: str):
        self.content = content


def test_classify_find_gunplay():
    llm = _FakeLlm(
        {
            "mode": "find_moments",
            "confidence": 0.92,
            "search_criteria": "枪战交火场面",
            "visual_profile": "gunplay",
            "search_strategy": "visual_primary",
            "recall_mode": "high",
            "export_target": "none",
            "reason": "用户要找枪战",
        }
    )
    result = classify_agent_intent(llm, "我要找到枪战")
    assert result.mode == "find_moments"
    assert result.visual_profile == "gunplay"
    assert result.search_strategy == "visual_primary"


def test_classify_analyze_content():
    llm = _FakeLlm(
        {
            "mode": "analyze_content",
            "confidence": 0.88,
            "search_criteria": "",
            "visual_profile": "none",
            "search_strategy": "text_primary",
            "recall_mode": "balanced",
            "export_target": "none",
            "reason": "问内容",
        }
    )
    result = classify_agent_intent(llm, "这段视频讲了什么")
    assert result.mode == "analyze_content"


def test_classify_low_confidence_falls_back():
    llm = _FakeLlm(
        {
            "mode": "find_moments",
            "confidence": 0.4,
            "search_criteria": "打斗",
            "visual_profile": "melee",
            "search_strategy": "visual_primary",
            "recall_mode": "balanced",
            "export_target": "none",
            "reason": "不确定",
        }
    )
    result = classify_agent_intent(llm, "帮我弄一下")
    assert result.confidence == 0.4

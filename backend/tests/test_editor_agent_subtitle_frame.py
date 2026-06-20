"""字幕帧视觉验证 API / 解析测试。"""
import json

from backend.services.editor_agent_service import EditorAgentService


class _FakeLlm:
    def parse_json_response(self, raw: str):
        return json.loads(raw)


def test_parse_subtitle_frame_verdict():
    service = EditorAgentService(llm_manager=_FakeLlm())
    raw = json.dumps(
        {
            "subtitle_visible": True,
            "overflow": "left",
            "issues": ["左侧贴边"],
            "suggested_actions": ["右移或缩小字号"],
            "summary": "字幕略超出左边界",
            "confidence": "high",
        },
        ensure_ascii=False,
    )
    verdict = service._parse_subtitle_frame_verdict(raw)
    assert verdict.overflow == "left"
    assert verdict.summary == "字幕略超出左边界"
    assert verdict.issues == ["左侧贴边"]


def test_validate_tool_calls_accepts_verify_subtitle_in_frame():
    from backend.services.editor_agent_tools import validate_tool_calls

    calls = validate_tool_calls([{"name": "verify_subtitle_in_frame", "arguments": {"overlay_id": "o1"}}])
    assert calls[0].name == "verify_subtitle_in_frame"

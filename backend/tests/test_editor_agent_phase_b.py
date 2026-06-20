"""Editor Agent Phase B tests."""
import pytest

from backend.services.editor_agent_tools import validate_tool_calls
from backend.services.editor_agent_service import EditorAgentService


def test_validate_tool_calls_accepts_add_text_overlay():
    calls = validate_tool_calls(
        [
            {
                "name": "add_text_overlay",
                "arguments": {"start_sec": 0, "content": "示例文案", "fontSize": 6},
            }
        ]
    )
    assert calls[0].name == "add_text_overlay"
    assert calls[0].arguments["content"] == "示例文案"


def test_validate_tool_calls_rejects_unknown_tool():
    with pytest.raises(ValueError, match="白名单"):
        validate_tool_calls([{"name": "delete_timeline", "arguments": {}}])


def test_parse_actions_fallback():
    content = '{"actions":[{"tool":"add_text_overlay","args":{"start_sec":1,"content":"x"}}]}'
    calls = EditorAgentService._parse_actions_fallback(content)
    assert len(calls) == 1
    assert calls[0].name == "add_text_overlay"

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


def test_validate_tool_calls_accepts_list_assets():
    calls = validate_tool_calls([{"name": "list_assets", "arguments": {"category": "clip"}}])
    assert calls[0].name == "list_assets"
    assert calls[0].arguments["category"] == "clip"


def test_validate_tool_calls_accepts_narrative_tools():
    calls = validate_tool_calls(
        [
            {
                "name": "add_clips_to_timeline",
                "arguments": {"clip_ids": ["c1", "c2"], "insert_index": 0},
            },
            {"name": "reorder_main_track", "arguments": {"block_id": "b1", "to_index": 1}},
            {"name": "set_transition", "arguments": {"block_id": "b1", "transition": "dissolve"}},
        ]
    )
    assert [call.name for call in calls] == [
        "add_clips_to_timeline",
        "reorder_main_track",
        "set_transition",
    ]


def test_validate_tool_calls_accepts_audio_tools():
    calls = validate_tool_calls(
        [
            {
                "name": "add_audio_clip",
                "arguments": {"asset_id": "bgm-1", "start_sec": 0, "volume": 0.5},
            },
            {"name": "update_block_audio", "arguments": {"block_id": "b1", "volume": 0.8}},
        ]
    )
    assert [call.name for call in calls] == ["add_audio_clip", "update_block_audio"]


def test_validate_tool_calls_rejects_unknown_tool():
    with pytest.raises(ValueError, match="白名单"):
        validate_tool_calls([{"name": "delete_timeline", "arguments": {}}])


def test_parse_actions_fallback():
    content = '{"actions":[{"tool":"add_text_overlay","args":{"start_sec":1,"content":"x"}}]}'
    calls = EditorAgentService._parse_actions_fallback(content)
    assert len(calls) == 1
    assert calls[0].name == "add_text_overlay"

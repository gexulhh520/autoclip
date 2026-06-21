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


def test_validate_tool_calls_accepts_pacing_tools():
    calls = validate_tool_calls(
        [
            {"name": "detect_silence_trim", "arguments": {"block_id": "b1", "apply": False}},
            {"name": "split_block_at_playhead", "arguments": {}},
            {"name": "remove_block", "arguments": {"block_id": "b1"}},
        ]
    )
    assert [call.name for call in calls] == [
        "detect_silence_trim",
        "split_block_at_playhead",
        "remove_block",
    ]


def test_validate_tool_calls_accepts_packaging_tools():
    calls = validate_tool_calls(
        [
            {
                "name": "set_text_animation",
                "arguments": {"overlay_id": "o1", "in_type": "fade", "in_duration_sec": 0.3},
            },
            {"name": "batch_apply_text_style", "arguments": {"fontSize": 6, "color": "#ffffff"}},
        ]
    )
    assert [call.name for call in calls] == ["set_text_animation", "batch_apply_text_style"]


def test_validate_tool_calls_accepts_capture_preview_frame():
    calls = validate_tool_calls(
        [{"name": "capture_preview_frame", "arguments": {"time_sec": 2.5, "max_width": 720}}]
    )
    assert calls[0].name == "capture_preview_frame"
    assert calls[0].arguments["time_sec"] == 2.5


def test_validate_tool_calls_accepts_add_captions_for_blocks():
    calls = validate_tool_calls(
        [
            {
                "name": "add_captions_for_blocks",
                "arguments": {
                    "block_ids": ["5639b30a-96e2-4934-ac7d-fbce1df76b08"],
                    "block_captions": [
                        {"block_id": "5639b30a-96e2-4934-ac7d-fbce1df76b08", "content": "春风"},
                    ],
                    "layout": "vertical",
                    "in_type": "fade",
                },
            }
        ]
    )
    assert calls[0].name == "add_captions_for_blocks"
    assert calls[0].arguments["layout"] == "vertical"


def test_validate_tool_calls_rejects_unknown_tool():
    with pytest.raises(ValueError, match="白名单"):
        validate_tool_calls([{"name": "delete_timeline", "arguments": {}}])


def test_parse_actions_fallback():
    content = '{"actions":[{"tool":"add_text_overlay","args":{"start_sec":1,"content":"x"}}]}'
    calls = EditorAgentService._parse_actions_fallback(content)
    assert len(calls) == 1
    assert calls[0].name == "add_text_overlay"

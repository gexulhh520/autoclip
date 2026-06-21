"""apply_caption_template 工具校验。"""
from backend.services.editor_agent_tools import validate_tool_calls


def test_validate_tool_calls_accepts_apply_caption_template_with_replace_existing():
    calls = validate_tool_calls(
        [
            {
                "name": "apply_caption_template",
                "arguments": {
                    "layout": "vertical",
                    "position": "bottom_center",
                    "replace_existing": True,
                    "entries": [{"block_id": "5639b30a-96e2-4934-ac7d-fbce1df76b08"}],
                },
            }
        ]
    )
    assert calls[0].arguments["replace_existing"] is True
    assert calls[0].arguments["entries"][0]["block_id"]


def test_validate_tool_calls_accepts_apply_caption_template_with_layout_position():
    calls = validate_tool_calls(
        [
            {
                "name": "apply_caption_template",
                "arguments": {
                    "layout": "horizontal",
                    "position": "bottom_center",
                    "entries": [
                        {
                            "block_id": "5639b30a-96e2-4934-ac7d-fbce1df76b08",
                            "text": "横排字幕",
                        }
                    ],
                    "animation": {"in_type": "fade"},
                },
            }
        ]
    )
    assert calls[0].arguments["layout"] == "horizontal"
    assert calls[0].arguments["position"] == "bottom_center"


def test_validate_tool_calls_accepts_apply_caption_template():
    calls = validate_tool_calls(
        [
            {
                "name": "apply_caption_template",
                "arguments": {
                    "template": "vertical_stagger",
                    "entries": [
                        {
                            "block_id": "5639b30a-96e2-4934-ac7d-fbce1df76b08",
                            "text": "春风",
                        }
                    ],
                    "animation": {"in_type": "fade", "stagger_sec": 0.08},
                },
            }
        ]
    )
    assert calls[0].name == "apply_caption_template"
    assert calls[0].arguments["entries"][0]["text"] == "春风"

"""submit_task_plan 与 task_context 校验。"""
from backend.services.editor_agent_tools import validate_tool_calls


def test_validate_tool_calls_accepts_submit_task_plan():
    calls = validate_tool_calls(
        [
            {
                "name": "submit_task_plan",
                "arguments": {
                    "goal": "竖排拆字并验证",
                    "tasks": [
                        {"id": "t1", "title": "竖排拆分", "hint": "layout=vertical"},
                        {"id": "t2", "title": "验证字幕"},
                    ],
                },
            }
        ]
    )
    assert calls[0].name == "submit_task_plan"
    assert len(calls[0].arguments["tasks"]) == 2


def test_validate_tool_calls_accepts_add_captions_for_blocks():
    calls = validate_tool_calls(
        [
            {
                "name": "add_captions_for_blocks",
                "arguments": {
                    "content": "我很好",
                    "layout": "vertical",
                    "skip_existing": True,
                    "in_type": "fade",
                },
            }
        ]
    )
    assert calls[0].name == "add_captions_for_blocks"
    assert calls[0].arguments["layout"] == "vertical"

    calls = validate_tool_calls(
        [
            {
                "name": "add_captions_for_blocks",
                "arguments": {
                    "use_block_draft": True,
                    "layout": "vertical",
                },
            }
        ]
    )
    assert calls[0].arguments.get("use_block_draft") is True


def test_validate_tool_calls_accepts_split_text_overlays_by_char():
    calls = validate_tool_calls(
        [
            {
                "name": "split_text_overlays_by_char",
                "arguments": {
                    "overlay_ids": ["o1", "o2"],
                    "layout": "vertical",
                    "in_type": "fade",
                },
            }
        ]
    )
    assert calls[0].name == "split_text_overlays_by_char"
    assert calls[0].arguments["layout"] == "vertical"

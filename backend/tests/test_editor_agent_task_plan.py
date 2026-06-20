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

"""editor_agent_debug 单元测试。"""
from backend.services.editor_agent_debug import (
    build_chat_context_report,
    classify_tool_calls,
    estimate_tokens_from_text,
    suggest_num_ctx,
)


def test_estimate_tokens_from_text():
    assert estimate_tokens_from_text("") == 0
    assert estimate_tokens_from_text("你好世界") >= 3


def test_suggest_num_ctx_scales_with_prompt():
    small = suggest_num_ctx(1000)
    large = suggest_num_ctx(50000)
    assert large >= small


def test_build_chat_context_report():
    messages = [{"role": "user", "content": "添加字幕"}]
    snapshot = {"session_id": "s1", "overlays": []}
    report = build_chat_context_report(messages, [], snapshot, None)
    assert report["message_count"] == 1
    assert report["snapshot_chars"] > 0
    assert report["estimated_prompt_tokens"] > 0
    assert report["suggested_num_ctx"] >= 8192


def test_classify_tool_calls():
    read, write = classify_tool_calls(
        [
            {"name": "get_timeline_summary", "arguments": {}},
            {"name": "update_overlay_params", "arguments": {}},
        ]
    )
    assert read == ["get_timeline_summary"]
    assert write == ["update_overlay_params"]

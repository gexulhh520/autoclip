"""剪辑 Agent 上下文体量估算与调试摘要。"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

# 与 OllamaProvider._resolve_num_ctx 一致：中文/混排约 1.1 字符/token
CHARS_PER_TOKEN = 1.1
CTX_STEPS = (8192, 16384, 32768, 65536, 131072)
NUM_PREDICT_DEFAULT = 4096


def estimate_tokens_from_text(text: str) -> int:
    if not text:
        return 0
    return int(len(text) / CHARS_PER_TOKEN) + 1


def estimate_tokens_from_json(data: Any) -> int:
    if data is None:
        return 0
    try:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        text = str(data)
    return estimate_tokens_from_text(text)


def suggest_num_ctx(estimated_prompt_tokens: int, num_predict: int = NUM_PREDICT_DEFAULT) -> int:
    """建议 Ollama num_ctx（与 llm_providers 阶梯一致）。"""
    needed = estimated_prompt_tokens + num_predict + 2048
    for size in CTX_STEPS:
        if size >= needed:
            return size
    return CTX_STEPS[-1]


def _messages_char_count(messages: List[Dict[str, Any]]) -> int:
    total = 0
    for msg in messages:
        total += len(str(msg.get("content") or ""))
        images = msg.get("images")
        if isinstance(images, list):
            for image in images:
                total += len(str(image))
    return total


def build_chat_context_report(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
    snapshot: Optional[Dict[str, Any]],
    layout_reference: Optional[Any],
) -> Dict[str, Any]:
    snapshot_chars = len(
        json.dumps(snapshot or {}, ensure_ascii=False, separators=(",", ":"))
    )
    layout_chars = 0
    if layout_reference is not None:
        if hasattr(layout_reference, "model_dump"):
            layout_chars = len(
                json.dumps(layout_reference.model_dump(), ensure_ascii=False, separators=(",", ":"))
            )
        else:
            layout_chars = len(
                json.dumps(layout_reference, ensure_ascii=False, separators=(",", ":"))
            )
    tool_chars = len(json.dumps(tools or [], ensure_ascii=False, separators=(",", ":")))
    messages_chars = _messages_char_count(messages)

    estimated_prompt_tokens = estimate_tokens_from_text(
        json.dumps(messages, ensure_ascii=False, separators=(",", ":"))
    ) + estimate_tokens_from_text(json.dumps(tools or [], ensure_ascii=False))

    return {
        "message_count": len(messages),
        "snapshot_chars": snapshot_chars,
        "layout_reference_chars": layout_chars,
        "tool_schema_chars": tool_chars,
        "messages_chars": messages_chars,
        "estimated_prompt_tokens": estimated_prompt_tokens,
        "suggested_num_ctx": suggest_num_ctx(estimated_prompt_tokens),
    }


def classify_tool_calls(tool_calls: List[Any]) -> tuple[List[str], List[str]]:
    """按名称粗分只读 / 写（与前端 toolRegistry 语义对齐，仅用于日志）。"""
    from backend.services.editor_agent_tools import META_AGENT_TOOLS, READ_ONLY_AGENT_TOOLS

    read_names: List[str] = []
    write_names: List[str] = []
    for call in tool_calls:
        name = getattr(call, "name", None) or (call.get("name") if isinstance(call, dict) else "")
        if not name:
            continue
        if name in META_AGENT_TOOLS:
            continue
        if name in READ_ONLY_AGENT_TOOLS:
            read_names.append(name)
        else:
            write_names.append(name)
    return read_names, write_names


def agent_debug_enabled() -> bool:
    return os.getenv("AUTOCLIP_AGENT_DEBUG", "").strip().lower() in ("1", "true", "yes")

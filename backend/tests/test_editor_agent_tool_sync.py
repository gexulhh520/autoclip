"""前后端 Agent 工具白名单应一致。"""
from __future__ import annotations

import re
from pathlib import Path

from backend.services.editor_agent_tools import EDITOR_AGENT_TOOL_NAMES

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL_REGISTRY = REPO_ROOT / "frontend" / "src" / "editor" / "agent" / "toolRegistry.ts"


def _frontend_tool_names() -> set[str]:
    text = TOOL_REGISTRY.read_text(encoding="utf-8")
    return set(re.findall(r"name: '([a-z_]+)'", text))


def test_backend_includes_add_captions_for_blocks():
    assert "add_captions_for_blocks" in EDITOR_AGENT_TOOL_NAMES


def test_frontend_backend_agent_tool_names_match():
    frontend = _frontend_tool_names()
    backend = set(EDITOR_AGENT_TOOL_NAMES)
    assert frontend == backend, (
        f"工具白名单不一致\n仅前端: {sorted(frontend - backend)}\n仅后端: {sorted(backend - frontend)}"
    )

"""Editor Agent layout analysis parsing tests."""
import json

import pytest

from backend.schemas.editor_agent import LayoutAnalysis
from backend.services.editor_agent_service import EditorAgentService


class _FakeLLMManager:
    def __init__(self, parsed: dict):
        self.parsed = parsed

    def parse_json_response(self, response: str):
        return self.parsed


SAMPLE_LAYOUT_JSON = {
    "layout_intent": "左侧多行文本排版",
    "canvas_hint": {"aspect": "9:16", "notes": "竖屏"},
    "elements": [
        {
            "role": "text",
            "content_hint": "示例文案",
            "transform": {
                "positionX": 0,
                "positionY": -320,
                "scaleX": 1,
                "scaleY": 1,
                "rotate": 0,
            },
            "fontSize": 48,
            "fontFamily": "Noto Sans SC",
            "color": "#FFFFFF",
            "fontWeight": "bold",
            "textAlign": "center",
            "lineHeight": 1.2,
            "background": {
                "enabled": True,
                "color": "#00000080",
                "paddingX": 24,
                "paddingY": 12,
                "cornerRadius": 8,
            },
        }
    ],
    "video_framing": {
        "notes": "人物偏左",
        "suggested_position_x": -40,
        "suggested_position_y": 0,
        "suggested_scale_x": 1,
        "suggested_scale_y": 1,
    },
}


def test_layout_analysis_schema_accepts_sample():
    layout = LayoutAnalysis.model_validate(SAMPLE_LAYOUT_JSON)
    assert layout.layout_intent == "左侧多行文本排版"
    assert len(layout.elements) == 1
    assert layout.elements[0].transform.positionY == -320
    assert layout.video_framing is not None
    assert layout.video_framing.suggested_position_x == -40


def test_parse_layout_analysis_from_service():
    service = EditorAgentService(llm_manager=_FakeLLMManager(SAMPLE_LAYOUT_JSON))
    layout = service._parse_layout_analysis(json.dumps(SAMPLE_LAYOUT_JSON))
    assert layout.elements[0].role == "text"


def test_parse_layout_analysis_rejects_invalid():
    service = EditorAgentService(llm_manager=_FakeLLMManager({"elements": "not-a-list"}))
    with pytest.raises(ValueError, match="不符合 schema"):
        service._parse_layout_analysis("{}")

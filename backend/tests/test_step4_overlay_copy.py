"""Step4 金句模板：标题步骤应生成叠加旁白并写入 content。"""

import json
from pathlib import Path

from backend.pipeline.step4_title import TitleGenerator, _is_overlay_copy_mode, run_step4_title
from backend.utils.llm_client import LLMClient


def test_is_overlay_copy_mode_golden_quote():
    assert _is_overlay_copy_mode({"clip_goal": "golden_quote"}) is True
    assert _is_overlay_copy_mode({"template_rules": {"subtitle_style": "quote_cinema"}}) is True
    assert _is_overlay_copy_mode({"clip_goal": "default"}) is False


def test_apply_overlay_copy_dict():
    gen = TitleGenerator(settings={"clip_goal": "golden_quote"})
    clip = {
        "id": 1,
        "outline": "原始话题很长很长",
        "content": ["旧要点"],
        "generated_title": "旧标题",
    }
    gen._apply_title_to_clip(
        clip,
        {
            "list_title": "列表短标题",
            "headline": "真正的成长",
            "body": ["是学会与自己和解", "而不是取悦所有人"],
        },
    )
    assert clip["generated_title"] == "列表短标题"
    assert clip["content"] == ["真正的成长", "是学会与自己和解", "而不是取悦所有人"]
    assert clip["overlay_copy"] is True
    assert clip["source_content"] == ["旧要点"]


def test_apply_overlay_copy_fallback_string():
    gen = TitleGenerator(settings={"clip_goal": "default"})
    clip = {"id": 1, "outline": "话题", "content": []}
    gen._apply_title_to_clip(clip, "普通标题")
    assert clip["generated_title"] == "普通标题"
    assert "overlay_copy" not in clip


def test_run_step4_overlay_copy_mock_llm(tmp_path, monkeypatch):
    scored = tmp_path / "scored.json"
    scored.write_text(
        json.dumps(
            [
                {
                    "id": 1,
                    "outline": "关于成长与自我接纳的长话题",
                    "content": ["原话很长"],
                    "final_score": 0.9,
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    metadata_dir = tmp_path / "metadata"
    metadata_dir.mkdir()

    def fake_call(self, prompt, input_data=None, max_retries=3):
        return json.dumps(
            {
                "1": {
                    "list_title": "成长与和解",
                    "headline": "真正的成长",
                    "body": ["是学会与自己和解"],
                }
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(LLMClient, "call_with_retry", fake_call)

    out = run_step4_title(
        scored,
        metadata_dir=str(metadata_dir),
        settings={"clip_goal": "golden_quote"},
    )
    assert out[0]["overlay_copy"] is True
    assert out[0]["content"][0] == "真正的成长"
    assert out[0]["generated_title"] == "成长与和解"

    saved = json.loads((metadata_dir / "step4_titles.json").read_text(encoding="utf-8"))
    assert saved[0]["overlay_copy"] is True

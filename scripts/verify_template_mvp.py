#!/usr/bin/env python3
"""基因模板 MVP 冒烟验证（无需 LLM / 真实视频）。"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.pipeline.goals.registry import GOAL_PROFILES
from backend.pipeline.pipelines.definitions import resolve_effective_step_order
from backend.pipeline.prompt_loader import load_goal_prompt_contents
from backend.pipeline.template_engine import get_template_engine, merge_template_settings


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    line = f"[{status}] {name}"
    if detail:
        line += f" — {detail}"
    print(line)
    return ok


def main() -> int:
    engine = get_template_engine()
    templates = engine.list_templates()
    all_ok = True

    all_ok &= check("template count", len(templates) >= 2, f"{len(templates)} templates")

    cinema = engine.get_template("golden_quote_cinema")
    digest = engine.get_template("knowledge_digest")

    cinema_settings = engine.resolve_processing_settings("golden_quote_cinema")
    all_ok &= check(
        "golden_quote_cinema settings",
        cinema_settings["clip_goal"] == "golden_quote"
        and cinema_settings["template_rules"]["subtitle_style"] == "quote_cinema",
    )

    digest_settings = engine.resolve_processing_settings("knowledge_digest")
    all_ok &= check(
        "knowledge_digest settings",
        digest_settings["clip_goal"] == "knowledge"
        and digest_settings["template_rules"]["enable_clustering"] is True,
    )

    merged = merge_template_settings(
        {"template_id": "golden_quote_cinema", "video_file": "demo.mp4"}
    )
    all_ok &= check(
        "merge_template_settings",
        merged.get("clip_duration_preset") == "short" and merged.get("video_file") == "demo.mp4",
    )

    cinema_steps = resolve_effective_step_order(GOAL_PROFILES["golden_quote"], cinema_settings)
    all_ok &= check(
        "cinema step order",
        "step5_clustering" not in cinema_steps and "step6_video" in cinema_steps,
        str(cinema_steps),
    )

    digest_steps = resolve_effective_step_order(GOAL_PROFILES["knowledge"], digest_settings)
    all_ok &= check(
        "digest step order",
        "step5_clustering" in digest_steps,
        str(digest_steps),
    )

    cinema_prompts = load_goal_prompt_contents(
        GOAL_PROFILES["golden_quote"],
        video_category="entertainment",
        settings=cinema_settings,
    )
    all_ok &= check(
        "cinema template prompt",
        "影视解说" in cinema_prompts.get("outline", ""),
    )

    digest_prompts = load_goal_prompt_contents(
        GOAL_PROFILES["knowledge"],
        video_category="knowledge",
        settings=digest_settings,
    )
    all_ok &= check(
        "digest template prompt",
        "知识干货拆条" in digest_prompts.get("outline", ""),
    )

    asset = ROOT / "backend" / "templates" / "assets" / "golden_quote_cinema.svg"
    all_ok &= check("preview asset exists", asset.is_file(), str(asset))

    all_ok &= check(
        "preview url configured",
        cinema.preview.thumbnail_url.endswith("golden_quote_cinema.svg"),
        cinema.preview.thumbnail_url,
    )

    print()
    if all_ok:
        print("Gene template MVP smoke checks passed.")
        return 0
    print("Some checks failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

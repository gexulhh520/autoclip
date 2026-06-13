"""统一 Prompt 加载：template pack + goal pack + video_category + duration 注入。"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from backend.core.clip_duration_config import (
    ClipDurationConfig,
    apply_duration_to_prompt,
    resolve_clip_duration_config,
)
from backend.core.shared_config import PROMPT_DIR, PROMPT_FILES, get_prompt_files
from backend.pipeline.goals.base import GoalProfile

logger = logging.getLogger(__name__)

GOALS_PROMPT_DIR = PROMPT_DIR / "goals"
TEMPLATES_PROMPT_DIR = PROMPT_DIR / "templates"

# prompt 内容 key → 文件名
PROMPT_FILE_NAMES: Dict[str, str] = {
    "outline": "大纲.txt",
    "timeline": "时间点.txt",
    "recommendation": "推荐理由.txt",
    "title": "标题生成.txt",
    "clustering": "主题聚类.txt",
    "collection_title": "collection_title.txt",
}

# moment pipeline 专用 prompt 文件名 → 内容 key
MOMENT_PROMPT_ALIASES: Dict[str, str] = {
    "scan_moments.txt": "outline",
    "bound.txt": "timeline",
}


def _read_prompt_file(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _effective_prompt_pack(goal: GoalProfile, settings: Optional[Dict[str, Any]] = None) -> str:
    settings = settings or {}
    return str(settings.get("prompt_pack") or goal.prompt_pack)


def _resolve_prompt_text(
    key: str,
    goal: GoalProfile,
    video_category: str,
    settings: Optional[Dict[str, Any]] = None,
) -> str:
    """
    解析优先级：
    1. settings.prompt_overrides 内联覆盖
    2. prompt/templates/{template_id}/
    3. prompt/goals/{prompt_pack}/
    4. video_category 覆盖
    5. 默认 prompt/
    """
    settings = settings or {}
    filename = PROMPT_FILE_NAMES.get(key)
    if not filename:
        return ""

    overrides = settings.get("prompt_overrides") or {}
    if key in overrides and overrides[key]:
        return str(overrides[key])

    template_id = settings.get("template_id")
    if template_id:
        template_path = TEMPLATES_PROMPT_DIR / str(template_id) / filename
        text = _read_prompt_file(template_path)
        if text is not None:
            return text

    prompt_pack = _effective_prompt_pack(goal, settings)
    goal_path = GOALS_PROMPT_DIR / prompt_pack / filename
    text = _read_prompt_file(goal_path)
    if text is not None:
        return text

    category_paths = get_prompt_files(video_category)
    cat_path = category_paths.get(key) or PROMPT_FILES.get(key)
    if cat_path:
        text = _read_prompt_file(Path(cat_path))
        if text is not None:
            return text

    default_path = PROMPT_FILES.get(key)
    if default_path:
        text = _read_prompt_file(Path(default_path))
        if text is not None:
            return text

    return ""


def _load_moment_aliases(
    goal: GoalProfile,
    contents: Dict[str, str],
    settings: Optional[Dict[str, Any]] = None,
) -> None:
    """moment pipeline 专用文件名覆盖 outline/timeline。"""
    settings = settings or {}
    template_id = settings.get("template_id")
    prompt_pack = _effective_prompt_pack(goal, settings)

    dirs: list[Path] = [GOALS_PROMPT_DIR / prompt_pack]
    if template_id:
        dirs.append(TEMPLATES_PROMPT_DIR / str(template_id))

    for goal_dir in dirs:
        if not goal_dir.exists():
            continue
        for filename, content_key in MOMENT_PROMPT_ALIASES.items():
            text = _read_prompt_file(goal_dir / filename)
            if text:
                contents[content_key] = text


def load_goal_prompt_contents(
    goal: GoalProfile,
    video_category: str = "default",
    duration_config: Optional[ClipDurationConfig] = None,
    settings: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    """加载并注入时长参数的 prompt 文本。"""
    if duration_config is None:
        duration_config = resolve_clip_duration_config(settings or {})

    contents: Dict[str, str] = {}
    for key in PROMPT_FILE_NAMES:
        template = _resolve_prompt_text(key, goal, video_category, settings)
        if not template:
            continue
        if key in ("outline", "timeline"):
            contents[key] = apply_duration_to_prompt(template, duration_config)
        else:
            contents[key] = template

    if goal.pipeline_id == "moment":
        _load_moment_aliases(goal, contents, settings)
        if "outline" in contents:
            contents["outline"] = apply_duration_to_prompt(contents["outline"], duration_config)
        if "timeline" in contents:
            contents["timeline"] = apply_duration_to_prompt(contents["timeline"], duration_config)

    return contents


def materialize_prompt_files(
    metadata_dir: Path,
    prompt_contents: Dict[str, str],
) -> Dict[str, Path]:
    """将 prompt 文本写入 metadata，供仍基于文件路径的旧 step 使用。"""
    resolved_dir = metadata_dir / "resolved_prompts"
    resolved_dir.mkdir(parents=True, exist_ok=True)
    files: Dict[str, Path] = {}

    for key, filename in PROMPT_FILE_NAMES.items():
        text = prompt_contents.get(key)
        if not text:
            continue
        out_path = resolved_dir / filename
        out_path.write_text(text, encoding="utf-8")
        files[key] = out_path

    if "recommendation" in files:
        files["scoring"] = files["recommendation"]

    return files


def save_goal_config_to_metadata(metadata_dir: Path, goal: GoalProfile) -> None:
    metadata_dir.mkdir(parents=True, exist_ok=True)
    path = metadata_dir / "clip_goal_config.json"
    path.write_text(json.dumps(goal.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")


def save_template_config_to_metadata(metadata_dir: Path, settings: Dict[str, Any]) -> None:
    """审计：写入本次运行使用的模板配置（项目级快照，后续迭代不自动覆盖）。"""
    template_id = settings.get("template_id")
    if not template_id:
        return
    from backend.pipeline.overlay_pipeline import build_overlay_snapshot

    metadata_dir.mkdir(parents=True, exist_ok=True)
    rules = settings.get("template_rules") or {}
    payload = {
        "template_id": template_id,
        "template_version": settings.get("template_version"),
        "prompt_pack": settings.get("prompt_pack"),
        "template_rules": rules,
        "subtitle_style": rules.get("subtitle_style"),
        "overlay": settings.get("overlay") or build_overlay_snapshot(settings),
    }
    path = metadata_dir / "template_config.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

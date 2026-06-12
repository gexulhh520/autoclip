"""统一 Prompt 加载：goal pack + video_category + duration 注入。"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, Optional

from backend.core.clip_duration_config import (
    ClipDurationConfig,
    apply_duration_to_prompt,
    resolve_clip_duration_config,
)
from backend.core.shared_config import PROMPT_DIR, PROMPT_FILES, get_prompt_files
from backend.pipeline.goals.base import GoalProfile

logger = logging.getLogger(__name__)

GOALS_PROMPT_DIR = PROMPT_DIR / "goals"

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


def _resolve_template(
    key: str,
    goal: GoalProfile,
    video_category: str,
) -> str:
    """goal pack 优先，其次 category，最后 default。"""
    filename = PROMPT_FILE_NAMES.get(key)
    if not filename:
        return ""

    goal_path = GOALS_PROMPT_DIR / goal.prompt_pack / filename
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


def _load_moment_aliases(goal: GoalProfile, contents: Dict[str, str]) -> None:
    """moment pipeline 专用文件名覆盖 outline/timeline。"""
    goal_dir = GOALS_PROMPT_DIR / goal.prompt_pack
    if not goal_dir.exists():
        return
    for filename, content_key in MOMENT_PROMPT_ALIASES.items():
        text = _read_prompt_file(goal_dir / filename)
        if text:
            contents[content_key] = text


def load_goal_prompt_contents(
    goal: GoalProfile,
    video_category: str = "default",
    duration_config: Optional[ClipDurationConfig] = None,
) -> Dict[str, str]:
    """加载并注入时长参数的 prompt 文本。"""
    if duration_config is None:
        duration_config = resolve_clip_duration_config()

    contents: Dict[str, str] = {}
    for key in PROMPT_FILE_NAMES:
        template = _resolve_template(key, goal, video_category)
        if not template:
            continue
        if key in ("outline", "timeline"):
            contents[key] = apply_duration_to_prompt(template, duration_config)
        else:
            contents[key] = template

    if goal.pipeline_id == "moment":
        _load_moment_aliases(goal, contents)
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

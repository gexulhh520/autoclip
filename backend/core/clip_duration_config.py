"""
切片时长配置 — 支持预设与自定义，并注入到 prompt 模板。
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from .shared_config import PROMPT_FILES, get_prompt_files

logger = logging.getLogger(__name__)


class ClipDurationPreset(str, Enum):
    SHORT = "short"          # 口播爆点 30–90s
    MEDIUM = "medium"        # 短视频 45s–3min
    STANDARD = "standard"    # 精华切片 1.5–5min（默认）
    LONG = "long"            # 长论述 2–8min
    CUSTOM = "custom"


@dataclass(frozen=True)
class ClipDurationConfig:
    preset: str
    min_seconds: int
    target_seconds: int
    max_seconds: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


CLIP_DURATION_PRESETS: Dict[str, ClipDurationConfig] = {
    ClipDurationPreset.SHORT.value: ClipDurationConfig(
        preset=ClipDurationPreset.SHORT.value,
        min_seconds=30,
        target_seconds=60,
        max_seconds=90,
    ),
    ClipDurationPreset.MEDIUM.value: ClipDurationConfig(
        preset=ClipDurationPreset.MEDIUM.value,
        min_seconds=45,
        target_seconds=90,
        max_seconds=180,
    ),
    ClipDurationPreset.STANDARD.value: ClipDurationConfig(
        preset=ClipDurationPreset.STANDARD.value,
        min_seconds=90,
        target_seconds=180,
        max_seconds=300,
    ),
    ClipDurationPreset.LONG.value: ClipDurationConfig(
        preset=ClipDurationPreset.LONG.value,
        min_seconds=120,
        target_seconds=240,
        max_seconds=480,
    ),
}

CLIP_DURATION_PRESET_META: List[Dict[str, Any]] = [
    {
        "value": ClipDurationPreset.SHORT.value,
        "name": "短片段",
        "description": "适合口播爆点、抖音/视频号，约 30–90 秒",
        "min_seconds": 30,
        "target_seconds": 60,
        "max_seconds": 90,
    },
    {
        "value": ClipDurationPreset.MEDIUM.value,
        "name": "短视频",
        "description": "适合小红书、快剪分发，约 45 秒–3 分钟",
        "min_seconds": 45,
        "target_seconds": 90,
        "max_seconds": 180,
    },
    {
        "value": ClipDurationPreset.STANDARD.value,
        "name": "精华切片",
        "description": "适合 B 站/知识类拆条，约 1.5–5 分钟（推荐）",
        "min_seconds": 90,
        "target_seconds": 180,
        "max_seconds": 300,
    },
    {
        "value": ClipDurationPreset.LONG.value,
        "name": "长论述",
        "description": "适合完整观点阐述，约 2–8 分钟",
        "min_seconds": 120,
        "target_seconds": 240,
        "max_seconds": 480,
    },
    {
        "value": ClipDurationPreset.CUSTOM.value,
        "name": "自定义",
        "description": "自行设定最短、目标、最长时长（秒）",
        "min_seconds": 90,
        "target_seconds": 180,
        "max_seconds": 300,
    },
]

DEFAULT_CLIP_DURATION_PRESET = ClipDurationPreset.STANDARD.value


def _format_duration_label(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}秒"
    minutes = seconds / 60
    if seconds % 60 == 0:
        return f"{int(minutes)}分钟"
    return f"{seconds}秒（约{minutes:.1f}分钟）"


def _format_duration_range(min_s: int, max_s: int) -> str:
    return f"{_format_duration_label(min_s)}–{_format_duration_label(max_s)}"


def build_prompt_context(config: ClipDurationConfig) -> Dict[str, str]:
    """生成 prompt 模板占位符替换表。"""
    return {
        "min_duration_seconds": str(config.min_seconds),
        "max_duration_seconds": str(config.max_seconds),
        "target_duration_seconds": str(config.target_seconds),
        "min_duration_label": _format_duration_label(config.min_seconds),
        "max_duration_label": _format_duration_label(config.max_seconds),
        "target_duration_label": _format_duration_label(config.target_seconds),
        "target_duration_range": _format_duration_range(config.min_seconds, config.max_seconds),
        "merge_threshold_seconds": str(max(30, config.min_seconds // 2)),
    }


def apply_duration_to_prompt(template: str, config: ClipDurationConfig) -> str:
    """将时长参数注入 prompt 文本（支持 {key} 占位符）。"""
    context = build_prompt_context(config)
    result = template
    for key, value in context.items():
        result = result.replace("{" + key + "}", value)
    return result


def resolve_clip_duration_config(settings: Optional[Dict[str, Any]] = None) -> ClipDurationConfig:
    """
    从项目 settings / processing_config 解析切片时长配置。
    支持字段：clip_duration_preset, clip_min_seconds, clip_target_seconds, clip_max_seconds
    """
    settings = settings or {}
    preset = settings.get("clip_duration_preset") or DEFAULT_CLIP_DURATION_PRESET

    if preset == ClipDurationPreset.CUSTOM.value:
        min_s = int(settings.get("clip_min_seconds") or 90)
        target_s = int(settings.get("clip_target_seconds") or 180)
        max_s = int(settings.get("clip_max_seconds") or 300)
        min_s = max(15, min_s)
        max_s = max(min_s + 15, max_s)
        target_s = max(min_s, min(target_s, max_s))
        return ClipDurationConfig(
            preset=preset,
            min_seconds=min_s,
            target_seconds=target_s,
            max_seconds=max_s,
        )

    base = CLIP_DURATION_PRESETS.get(preset, CLIP_DURATION_PRESETS[DEFAULT_CLIP_DURATION_PRESET])
    return base


def load_resolved_prompt_contents(
    video_category: str = "default",
    duration_config: Optional[ClipDurationConfig] = None,
) -> Dict[str, str]:
    """
    加载并注入时长参数的 prompt 文本。
    返回 {outline, timeline, recommendation, title, clustering, collection_title}
    """
    if duration_config is None:
        duration_config = resolve_clip_duration_config()

    prompt_paths = get_prompt_files(video_category)
    contents: Dict[str, str] = {}
    for key, path in prompt_paths.items():
        try:
            template = Path(path).read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("读取 prompt 失败 %s: %s，回退默认", path, exc)
            template = Path(PROMPT_FILES[key]).read_text(encoding="utf-8")
        if key in ("outline", "timeline"):
            contents[key] = apply_duration_to_prompt(template, duration_config)
        else:
            contents[key] = template
    return contents


def save_duration_config_to_metadata(metadata_dir: Path, config: ClipDurationConfig) -> None:
    """将时长配置写入项目 metadata，便于排查与续跑。"""
    metadata_dir.mkdir(parents=True, exist_ok=True)
    out_path = metadata_dir / "clip_duration_config.json"
    out_path.write_text(
        json.dumps(config.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

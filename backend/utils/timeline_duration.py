"""
时间线时长校验与拆分 — 作为 prompt 之外的代码兜底。
"""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.clip_duration_config import ClipDurationConfig
from ..utils.text_processor import TextProcessor

logger = logging.getLogger(__name__)


def _seconds_to_srt(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        secs += 1
        millis = 0
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _load_all_srt_entries(metadata_dir: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    srt_dir = metadata_dir / "step1_srt_chunks"
    if not srt_dir.exists():
        return entries
    tp = TextProcessor()
    for chunk_file in sorted(srt_dir.glob("chunk_*.json")):
        try:
            chunk_data = json.loads(chunk_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for sub in chunk_data:
            start = tp.time_to_seconds(sub.get("start_time", "00:00:00,000"))
            end = tp.time_to_seconds(sub.get("end_time", "00:00:00,000"))
            entries.append({
                "start_time": sub.get("start_time"),
                "end_time": sub.get("end_time"),
                "start_sec": start,
                "end_sec": end,
                "text": sub.get("text", ""),
            })
    entries.sort(key=lambda x: x["start_sec"])
    return entries


def _find_split_point(
    start_sec: float,
    end_sec: float,
    max_seconds: int,
    srt_entries: List[Dict[str, Any]],
) -> Optional[float]:
    """在片段内找最接近 max_seconds 的自然切分点（字幕句末）。"""
    duration = end_sec - start_sec
    if duration <= max_seconds:
        return None

    ideal = start_sec + max_seconds
    candidates = [
        e["end_sec"]
        for e in srt_entries
        if start_sec < e["end_sec"] < end_sec
    ]
    if not candidates:
        return ideal

    # 优先选 ideal 附近 ±20% max 范围内的句末
    window = max_seconds * 0.2
    in_window = [c for c in candidates if abs(c - ideal) <= window]
    pool = in_window if in_window else candidates
    return min(pool, key=lambda c: abs(c - ideal))


def _split_timeline_item(
    item: Dict[str, Any],
    max_seconds: int,
    srt_entries: List[Dict[str, Any]],
    tp: TextProcessor,
) -> List[Dict[str, Any]]:
    start_sec = tp.time_to_seconds(item["start_time"])
    end_sec = tp.time_to_seconds(item["end_time"])
    duration = end_sec - start_sec

    if duration <= max_seconds:
        return [item]

    parts: List[Dict[str, Any]] = []
    cursor = start_sec
    part_idx = 1
    base_outline = item.get("outline", "片段")
    content = item.get("content") or []

    while cursor < end_sec - 1:
        remaining = end_sec - cursor
        if remaining <= max_seconds:
            part = deepcopy(item)
            part["start_time"] = _seconds_to_srt(cursor)
            part["end_time"] = _seconds_to_srt(end_sec)
            if part_idx > 1:
                part["outline"] = f"{base_outline}（{part_idx}）"
            parts.append(part)
            break

        split_at = _find_split_point(cursor, end_sec, max_seconds, srt_entries)
        if split_at is None or split_at <= cursor + 15:
            split_at = min(cursor + max_seconds, end_sec)

        part = deepcopy(item)
        part["start_time"] = _seconds_to_srt(cursor)
        part["end_time"] = _seconds_to_srt(split_at)
        part["outline"] = f"{base_outline}（{part_idx}）" if part_idx > 1 or remaining > max_seconds else base_outline
        if isinstance(content, list) and len(content) > 1:
            chunk_size = max(1, len(content) // max(2, int(duration / max_seconds) + 1))
            start_i = (part_idx - 1) * chunk_size
            part["content"] = content[start_i:start_i + chunk_size] or content[:1]
        parts.append(part)
        cursor = split_at + 0.001
        part_idx += 1

    logger.info(
        "超长片段已拆分: '%s' %.0fs → %d 段 (上限 %ds)",
        base_outline,
        duration,
        len(parts),
        max_seconds,
    )
    return parts


def enforce_timeline_duration_limits(
    timeline_data: List[Dict[str, Any]],
    duration_config: ClipDurationConfig,
    metadata_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """
    拆分超过 max_seconds 的片段（代码兜底，不依赖 LLM 自觉）。
    """
    if not timeline_data:
        return timeline_data

    tp = TextProcessor()
    srt_entries = _load_all_srt_entries(metadata_dir) if metadata_dir else []
    result: List[Dict[str, Any]] = []

    for item in timeline_data:
        try:
            start_sec = tp.time_to_seconds(item["start_time"])
            end_sec = tp.time_to_seconds(item["end_time"])
        except (KeyError, ValueError, TypeError):
            result.append(item)
            continue

        duration = end_sec - start_sec
        if duration > duration_config.max_seconds:
            result.extend(
                _split_timeline_item(item, duration_config.max_seconds, srt_entries, tp)
            )
        else:
            result.append(item)

    if len(result) != len(timeline_data):
        for i, item in enumerate(result):
            item["id"] = str(i + 1)

    return result

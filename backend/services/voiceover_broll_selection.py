"""口播 B-roll 语义选段：区间对齐与时长匹配。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class BrollTrimSelection:
    source_in_sec: float
    source_out_sec: float
    selection_reason: str
    match_score: float = 0.0


def build_broll_search_criteria(*, visual_brief: str, narration_text: str) -> str:
    parts: List[str] = []
    brief = (visual_brief or "").strip()
    narration = (narration_text or "").strip()
    if brief:
        parts.append(brief)
    if narration:
        parts.append(narration[:240])
    return "；".join(parts) or "与口播内容相符的画面"


def pick_best_semantic_match(matches: List[Any]) -> Optional[Any]:
    if not matches:
        return None
    return max(matches, key=lambda item: float(getattr(item, "match_score", 0) or 0))


def align_interval_to_target_duration(
    *,
    match_in_sec: float,
    match_out_sec: float,
    target_duration_sec: float,
    source_duration_sec: float,
    match_reason: str = "",
    match_score: float = 0.0,
    tolerance_sec: float = 0.1,
) -> BrollTrimSelection:
    target = max(0.1, float(target_duration_sec))
    source_max = max(0.1, float(source_duration_sec))
    start = max(0.0, float(match_in_sec))
    end = max(start + 0.05, float(match_out_sec))
    match_len = end - start

    if match_len + tolerance_sec >= target:
        out_sec = min(source_max, start + target)
        in_sec = max(0.0, out_sec - target)
        reason = (
            f"语义检索命中 {start:.2f}s–{end:.2f}s（得分 {match_score:.2f}），"
            f"裁取 {in_sec:.2f}s–{out_sec:.2f}s 与口播等长"
        )
    else:
        center = (start + end) / 2.0
        half = target / 2.0
        in_sec = max(0.0, center - half)
        out_sec = min(source_max, in_sec + target)
        in_sec = max(0.0, out_sec - target)
        reason = (
            f"语义区间 {start:.2f}s–{end:.2f}s 较短，已以中心 {center:.2f}s 扩展至 "
            f"{in_sec:.2f}s–{out_sec:.2f}s（目标 {target:.2f}s）"
        )

    if match_reason.strip():
        reason = f"{reason}。{match_reason.strip()}"

    return BrollTrimSelection(
        source_in_sec=in_sec,
        source_out_sec=out_sec,
        selection_reason=reason,
        match_score=match_score,
    )


def block_dict_for_search(
    *,
    rel_media_path: str,
    source_duration_sec: float,
    block_id: str = "vo-broll-search",
) -> Dict[str, Any]:
    duration = max(0.1, float(source_duration_sec))
    return {
        "id": block_id,
        "media": {"type": "imported_clip", "path": rel_media_path},
        "trim": {"in_sec": 0.0, "out_sec": duration},
        "duration_sec": duration,
        "playback_rate": 1.0,
    }


def apply_manual_trim_override(
    *,
    source_in_sec: float,
    source_out_sec: float,
    target_duration_sec: float,
    source_duration_sec: float,
    previous_reason: str = "",
) -> BrollTrimSelection:
    target = max(0.1, float(target_duration_sec))
    source_max = max(0.1, float(source_duration_sec))
    in_sec = max(0.0, min(float(source_in_sec), source_max - 0.05))
    out_sec = max(in_sec + 0.05, min(float(source_out_sec), source_max))
    span = out_sec - in_sec

    if abs(span - target) > 0.11:
        out_sec = min(source_max, in_sec + target)
        in_sec = max(0.0, out_sec - target)
        reason = (
            f"用户指定 in/out 后按口播时长 {target:.2f}s 对齐为 "
            f"{in_sec:.2f}s–{out_sec:.2f}s"
        )
    else:
        reason = f"用户确认选段 {in_sec:.2f}s–{out_sec:.2f}s"

    if previous_reason.strip():
        reason = f"{previous_reason.strip()}；{reason}"

    return BrollTrimSelection(
        source_in_sec=in_sec,
        source_out_sec=out_sec,
        selection_reason=reason,
    )

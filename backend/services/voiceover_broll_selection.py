"""口播 B-roll 语义选段：区间对齐与时长匹配。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from backend.schemas.edit_session import EditBlock
from backend.schemas.voiceover_plan import VoiceoverSegment


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


def fallback_broll_trim_selection(
    *,
    target_duration_sec: float,
    source_duration_sec: float,
    criteria: str = "",
) -> BrollTrimSelection:
    target = max(0.1, float(target_duration_sec))
    source_max = max(0.1, float(source_duration_sec))
    in_sec = 0.0
    out_sec = min(source_max, target)
    brief = (criteria or "").strip()
    if len(brief) > 48:
        brief = f"{brief[:48]}…"
    label = brief or "口播描述"
    return BrollTrimSelection(
        source_in_sec=in_sec,
        source_out_sec=out_sec,
        selection_reason=(
            f"未找到与「{label}」精确匹配的片段，"
            f"已选用素材开头 {in_sec:.2f}s–{out_sec:.2f}s 与口播等长"
        ),
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
    trim_anchor: str = "in",
) -> BrollTrimSelection:
    target = max(0.1, float(target_duration_sec))
    raw_in = float(source_in_sec)
    raw_out = float(source_out_sec)
    # 用户选段可能超出 block.duration_sec（时间线时长），需以选段边界扩展素材上限
    source_max = max(0.1, float(source_duration_sec), raw_out, raw_in + 0.05)

    user_out = max(0.05, min(raw_out, source_max))
    user_in = max(0.0, min(raw_in, user_out - 0.05))
    user_span = user_out - user_in
    tolerance = 0.1
    anchor = (trim_anchor or "in").strip().lower()
    if anchor not in ("in", "out"):
        anchor = "in"

    if abs(user_span - target) <= tolerance:
        in_sec = user_in
        out_sec = user_out
        reason = f"用户确认选段 {in_sec:.2f}s–{out_sec:.2f}s"
    else:
        if anchor == "out":
            out_sec = user_out
            in_sec = max(0.0, out_sec - target)
        else:
            in_sec = user_in
            out_sec = min(source_max, in_sec + target)
        if out_sec - in_sec < target - 0.001:
            if anchor == "out":
                in_sec = max(0.0, out_sec - target)
            else:
                out_sec = min(source_max, in_sec + target)
                in_sec = max(0.0, out_sec - target)
        reason = (
            f"用户选段 {user_in:.2f}s–{user_out:.2f}s，"
            f"按口播 {target:.2f}s 对齐为 {in_sec:.2f}s–{out_sec:.2f}s"
        )

    if previous_reason.strip():
        reason = f"{previous_reason.strip()}；{reason}"

    return BrollTrimSelection(
        source_in_sec=in_sec,
        source_out_sec=out_sec,
        selection_reason=reason,
    )


def normalize_broll_block_trim_for_timeline(
    trim_in_sec: float,
    trim_out_sec: float,
    duration_sec: float,
    media: Optional[dict] = None,
) -> Tuple[float, float, float, dict]:
    """把源素材入点写入 media.source_start_sec，时间线 trim 从 0 起算，避免主轨把 in 当成时间轴偏移。"""
    media = dict(media or {})
    trim_in = float(trim_in_sec)
    trim_out = float(trim_out_sec)
    duration = max(0.1, float(duration_sec))
    span = trim_out - trim_in if trim_out > trim_in + 0.001 else duration

    if trim_in > 0.001:
        media["source_start_sec"] = round(trim_in, 3)
    else:
        media.pop("source_start_sec", None)

    return 0.0, span, duration, media


def align_existing_block_trim_to_audio(
    *,
    block: EditBlock,
    segment: VoiceoverSegment,
    target_duration_sec: float,
    source_duration_sec: float,
) -> BrollTrimSelection:
    """重应用 B-roll：保留原 block 媒体，仅按口播时长对齐 trim。"""
    in_sec = segment.broll.source_in_sec
    out_sec = segment.broll.source_out_sec
    if in_sec is None or out_sec is None:
        in_sec = float(block.trim.in_sec or 0.0)
        out_sec = float(block.trim.out_sec or target_duration_sec)
    return apply_manual_trim_override(
        source_in_sec=in_sec,
        source_out_sec=out_sec,
        target_duration_sec=target_duration_sec,
        source_duration_sec=source_duration_sec,
        previous_reason=segment.broll.selection_reason or "",
    )

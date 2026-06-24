"""词级 TTS 时间轴 → 屏幕显示字幕（CPL / CPS / 停顿 / 标点编组）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from backend.schemas.edit_session import EditSession
from backend.utils.edge_tts_service import (
    MAX_SUBTITLE_DISPLAY_CHARS,
    SubtitleCueTiming,
    _visible_char_count,
)

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_STRONG_PUNCT = frozenset("。！？；.!?;")
_WEAK_PUNCT = frozenset("，,、：:")


@dataclass(frozen=True)
class SubtitleDisplayRules:
    max_chars_per_line: int = MAX_SUBTITLE_DISPLAY_CHARS
    max_cps: float = 6.0
    min_duration_sec: float = 0.55
    max_duration_sec: float = 6.0
    pause_break_sec: float = 0.28

    @classmethod
    def from_session(cls, session: Optional[EditSession]) -> "SubtitleDisplayRules":
        aspect = "9:16"
        if session and session.export_settings:
            aspect = str(session.export_settings.aspect or "9:16")
        if aspect == "16:9":
            return cls(max_chars_per_line=18, max_cps=6.5)
        return cls()


def _ends_with_punct(text: str, punct: frozenset[str]) -> bool:
    stripped = text.rstrip()
    return bool(stripped) and stripped[-1] in punct


def _join_word_texts(words: List[SubtitleCueTiming]) -> str:
    parts = [item.text.strip() for item in words if item.text.strip()]
    if not parts:
        return ""
    joined = "".join(parts)
    if _CJK_RE.search(joined):
        return joined
    return " ".join(parts)


def _normalize_word_units(words: List[SubtitleCueTiming]) -> List[SubtitleCueTiming]:
    ordered = sorted(
        [item for item in words if item.text.strip()],
        key=lambda item: (item.start_sec, item.end_sec),
    )
    normalized: List[SubtitleCueTiming] = []
    for item in ordered:
        start = max(0.0, float(item.start_sec))
        end = max(start + 0.02, float(item.end_sec))
        normalized.append(
            SubtitleCueTiming(
                text=item.text.strip(),
                start_sec=start,
                end_sec=end,
                boundary_type=item.boundary_type or "WordBoundary",
            )
        )
    return normalized


def _split_group_by_duration(
    group: List[SubtitleCueTiming],
    rules: SubtitleDisplayRules,
) -> List[List[SubtitleCueTiming]]:
    if len(group) <= 1:
        return [group] if group else []
    span = group[-1].end_sec - group[0].start_sec
    if span <= rules.max_duration_sec:
        return [group]
    mid = max(1, len(group) // 2)
    left = _split_group_by_duration(group[:mid], rules)
    right = _split_group_by_duration(group[mid:], rules)
    return left + right


def _group_words_into_cards(
    words: List[SubtitleCueTiming],
    rules: SubtitleDisplayRules,
) -> List[List[SubtitleCueTiming]]:
    if not words:
        return []

    groups: List[List[SubtitleCueTiming]] = []
    current: List[SubtitleCueTiming] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if not current:
            return
        for chunk in _split_group_by_duration(current, rules):
            groups.append(chunk)
        current = []
        current_chars = 0

    prev_end: Optional[float] = None
    for word in words:
        word_chars = _visible_char_count(word.text)
        gap = 0.0 if prev_end is None else max(0.0, word.start_sec - prev_end)

        would_exceed = current and current_chars + word_chars > rules.max_chars_per_line
        pause_break = current and gap >= rules.pause_break_sec
        strong_break = current and _ends_with_punct(current[-1].text, _STRONG_PUNCT)
        weak_break = (
            current
            and would_exceed
            and _ends_with_punct(current[-1].text, _WEAK_PUNCT)
        )

        if current and (would_exceed or pause_break or strong_break or weak_break):
            flush()

        current.append(word)
        current_chars += word_chars
        prev_end = word.end_sec

    flush()
    return groups


def _card_to_cue(
    card_words: List[SubtitleCueTiming],
    rules: SubtitleDisplayRules,
) -> SubtitleCueTiming:
    text = _join_word_texts(card_words)
    start = card_words[0].start_sec
    speech_end = card_words[-1].end_sec

    char_count = max(1, _visible_char_count(text))
    end = speech_end

    min_end = start + rules.min_duration_sec
    if end < min_end:
        end = min(min_end, speech_end + 0.2)

    cps_end = start + char_count / rules.max_cps
    if cps_end > end:
        end = min(cps_end, speech_end + 0.35)

    max_end = start + rules.max_duration_sec
    end = min(end, max_end)
    if end <= start:
        end = start + 0.08

    return SubtitleCueTiming(
        text=text,
        start_sec=start,
        end_sec=end,
        boundary_type="DisplayRegroup",
    )


def _finalize_cue_timeline(
    cues: List[SubtitleCueTiming],
    speech_end: float,
) -> List[SubtitleCueTiming]:
    if not cues:
        return []
    finalized: List[SubtitleCueTiming] = []
    for index, cue in enumerate(cues):
        start = cue.start_sec
        end = cue.end_sec
        if index + 1 < len(cues):
            end = min(end, cues[index + 1].start_sec)
        else:
            end = min(end, speech_end)
        end = max(end, start + 0.08)
        finalized.append(
            SubtitleCueTiming(
                text=cue.text,
                start_sec=start,
                end_sec=end,
                boundary_type=cue.boundary_type,
            )
        )
    return finalized


def _merge_short_cues(
    cues: List[SubtitleCueTiming],
    rules: SubtitleDisplayRules,
) -> List[SubtitleCueTiming]:
    if len(cues) <= 1:
        return cues

    merged: List[SubtitleCueTiming] = []
    index = 0
    while index < len(cues):
        current = cues[index]
        duration = current.end_sec - current.start_sec
        chars = _visible_char_count(current.text)
        if (
            index + 1 < len(cues)
            and duration < rules.min_duration_sec * 0.85
            and chars + _visible_char_count(cues[index + 1].text) <= rules.max_chars_per_line
        ):
            nxt = cues[index + 1]
            combined_text = (
                current.text + nxt.text
                if _CJK_RE.search(current.text + nxt.text)
                else f"{current.text} {nxt.text}".strip()
            )
            merged.append(
                SubtitleCueTiming(
                    text=combined_text,
                    start_sec=current.start_sec,
                    end_sec=max(nxt.end_sec, current.start_sec + rules.min_duration_sec),
                    boundary_type="DisplayRegroup",
                )
            )
            index += 2
            continue
        merged.append(current)
        index += 1
    return merged


def regroup_words_to_display_cues(
    words: List[SubtitleCueTiming],
    rules: Optional[SubtitleDisplayRules] = None,
    *,
    sentence_fallback: Optional[List[SubtitleCueTiming]] = None,
) -> List[SubtitleCueTiming]:
    """词级时间轴 → 屏幕显示字幕卡片。"""
    rules = rules or SubtitleDisplayRules()
    units = _normalize_word_units(words)
    if not units:
        return list(sentence_fallback or [])

    groups = _group_words_into_cards(units, rules)
    cues = [_card_to_cue(group, rules) for group in groups if group]
    cues = _merge_short_cues(cues, rules)
    speech_end = units[-1].end_sec
    cues = _finalize_cue_timeline(cues, speech_end)

    if not cues and sentence_fallback:
        return list(sentence_fallback)
    return cues

"""口播字幕词级编组单元测试。"""
from __future__ import annotations

import pytest

from backend.services.voiceover_subtitle_regroup import (
    SubtitleDisplayRules,
    regroup_words_to_display_cues,
)
from backend.utils.edge_tts_service import SubtitleCueTiming


def _build_char_word_timings(text: str, *, duration_sec: float = 8.0) -> list[SubtitleCueTiming]:
    units = [char for char in text if not char.isspace()]
    if not units:
        return []
    step = duration_sec / len(units)
    cursor = 0.0
    timings: list[SubtitleCueTiming] = []
    for unit in units:
        end = cursor + step
        timings.append(
            SubtitleCueTiming(
                text=unit,
                start_sec=cursor,
                end_sec=end,
                boundary_type="WordBoundary",
            )
        )
        cursor = end
    return timings


def test_regroup_splits_long_line_by_punctuation_and_cpl():
    text = (
        "在影片中，李连杰饰演的角色并非简单的武林高手，"
        "而是一个在复杂政治漩涡中挣扎的孤独灵魂。"
    )
    words = _build_char_word_timings(text, duration_sec=10.0)
    cues = regroup_words_to_display_cues(words, SubtitleDisplayRules())

    assert len(cues) >= 3
    for cue in cues:
        assert len(cue.text.replace(" ", "")) <= 18
    assert cues[0].start_sec == pytest.approx(0.0, abs=0.01)
    assert cues[-1].end_sec == pytest.approx(10.0, abs=0.05)
    assert cues[0].boundary_type == "DisplayRegroup"


def test_regroup_uses_word_timing_not_equal_split():
    words = [
        SubtitleCueTiming(text="你好", start_sec=0.0, end_sec=0.4, boundary_type="WordBoundary"),
        SubtitleCueTiming(text="，", start_sec=0.4, end_sec=0.45, boundary_type="WordBoundary"),
        SubtitleCueTiming(text="世界", start_sec=0.45, end_sec=1.0, boundary_type="WordBoundary"),
        SubtitleCueTiming(text="。", start_sec=1.0, end_sec=1.05, boundary_type="WordBoundary"),
    ]
    cues = regroup_words_to_display_cues(words, SubtitleDisplayRules(max_chars_per_line=14))
    assert len(cues) == 1
    assert cues[0].text == "你好，世界。"
    assert cues[0].start_sec == pytest.approx(0.0)
    assert cues[0].end_sec >= 1.05


def test_regroup_falls_back_to_sentence_cues():
    fallback = [
        SubtitleCueTiming(text="兜底字幕。", start_sec=0.0, end_sec=2.0),
    ]
    cues = regroup_words_to_display_cues([], sentence_fallback=fallback)
    assert cues == fallback

"""滑窗 clip 事件检测单元测试。"""
from backend.services.clip_event_detector import (
    ClipScoreRecord,
    build_sliding_windows,
    merge_clip_scores,
)


def test_build_sliding_windows_60s():
    windows = build_sliding_windows(0.0, 60.0, window_size=16.0, stride=4.0)
    assert len(windows) >= 12
    assert windows[0] == (0.0, 16.0)
    assert windows[1] == (4.0, 20.0)


def test_merge_clip_scores_overlapping_windows():
    records = [
        ClipScoreRecord(64.0, 80.0, 0.91, True, "fight a"),
        ClipScoreRecord(68.0, 84.0, 0.92, True, "fight b"),
        ClipScoreRecord(72.0, 88.0, 0.90, True, "fight c"),
        ClipScoreRecord(76.0, 92.0, 0.10, False, "calm"),
    ]
    merged = merge_clip_scores(records, score_threshold=0.7, merge_gap_sec=8.0)
    assert len(merged) == 1
    start, end, score, _ = merged[0]
    assert start == 64.0
    assert end == 88.0
    assert 0.9 <= score <= 0.92


def test_merge_clip_scores_gap_break():
    records = [
        ClipScoreRecord(10.0, 26.0, 0.85, True, "a"),
        ClipScoreRecord(50.0, 66.0, 0.88, True, "b"),
    ]
    merged = merge_clip_scores(records, score_threshold=0.7, merge_gap_sec=8.0)
    assert len(merged) == 2

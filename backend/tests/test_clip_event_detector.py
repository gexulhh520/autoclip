"""Coarse-to-Fine clip 事件检测单元测试。"""
from backend.services.clip_event_detector import (
    ClipScoreRecord,
    build_sliding_windows,
    coarse_hits_to_hotspots,
    merge_clip_scores,
    select_peak_hotspots,
)


def test_build_sliding_windows_60s_coarse():
    windows = build_sliding_windows(0.0, 3600.0, window_size=60.0, stride=45.0)
    assert 75 <= len(windows) <= 85
    assert windows[0] == (0.0, 60.0)
    assert windows[1] == (45.0, 105.0)


def test_filter_windows_within_hotspots():
    from backend.services.clip_event_detector import filter_windows_within_hotspots

    hotspots = [(100.0, 160.0)]
    windows = [(90.0, 106.0), (200.0, 216.0), (120.0, 136.0)]
    filtered = filter_windows_within_hotspots(windows, hotspots)
    assert (120.0, 136.0) in filtered
    assert (200.0, 216.0) not in filtered


def test_build_sliding_windows_fine_60s():
    windows = build_sliding_windows(0.0, 60.0, window_size=16.0, stride=4.0)
    assert len(windows) >= 12
    assert windows[0] == (0.0, 16.0)


def test_coarse_hits_to_hotspots_with_pad():
    records = [
        ClipScoreRecord(600.0, 660.0, 0.7, True, "fight"),
        ClipScoreRecord(630.0, 690.0, 0.65, True, "fight b"),
    ]
    hotspots = coarse_hits_to_hotspots(
        records,
        0.0,
        3600.0,
        score_threshold=0.45,
        pad_sec=20.0,
    )
    assert len(hotspots) == 1
    assert hotspots[0][0] <= 600.0
    assert hotspots[0][1] >= 690.0


def test_coarse_dense_hits_falls_back_to_peak_hotspots():
    records = [
        ClipScoreRecord(float(i * 45), float(i * 45 + 60), 0.9 - i * 0.001, True, f"hit {i}")
        for i in range(80)
    ]
    hotspots = coarse_hits_to_hotspots(
        records,
        0.0,
        3600.0,
        score_threshold=0.45,
        coarse_window_count=80,
    )
    assert len(hotspots) <= 12
    assert hotspots[0][1] - hotspots[0][0] < 3600.0 * 0.25


def test_select_peak_hotspots_spreads_high_scores():
    records = [
        ClipScoreRecord(100.0, 160.0, 0.95, True, "fight a"),
        ClipScoreRecord(1200.0, 1260.0, 0.88, True, "fight b"),
        ClipScoreRecord(2400.0, 2460.0, 0.82, True, "fight c"),
    ]
    hotspots = select_peak_hotspots(records, 0.0, 3600.0, score_threshold=0.45)
    assert len(hotspots) == 3


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

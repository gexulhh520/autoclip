"""Coarse-to-Fine clip 事件检测单元测试。"""
from backend.services.clip_event_detector import (
    ClipScoreRecord,
    ClipScanPlan,
    build_sliding_windows,
    coarse_hits_to_hotspots,
    filter_windows_by_roi,
    merge_clip_scores,
    resolve_scan_plan,
)


def test_build_sliding_windows_60s_coarse():
    windows = build_sliding_windows(0.0, 3600.0, window_size=60.0, stride=30.0)
    # 2h ≈ 120 windows at 60/30
    assert 110 <= len(windows) <= 125
    assert windows[0] == (0.0, 60.0)
    assert windows[1] == (30.0, 90.0)


def test_build_sliding_windows_fine_60s():
    windows = build_sliding_windows(0.0, 60.0, window_size=16.0, stride=4.0)
    assert len(windows) >= 12
    assert windows[0] == (0.0, 16.0)


def test_resolve_scan_plan_fight():
    plan = resolve_scan_plan("找所有打斗片段", duration_sec=3600.0)
    assert plan.strategy == "motion_first"
    assert plan.use_motion_prefilter is True
    assert plan.coarse_enabled is True


def test_resolve_scan_plan_emotion():
    plan = resolve_scan_plan("找主角哭泣的片段", duration_sec=600.0)
    assert plan.strategy == "semantic_scan"
    assert plan.use_motion_prefilter is False


def test_resolve_scan_plan_short_video_skips_coarse():
    plan = resolve_scan_plan("找打斗", duration_sec=120.0)
    assert plan.coarse_enabled is False


def test_filter_windows_by_roi():
    windows = build_sliding_windows(0.0, 300.0, window_size=60.0, stride=30.0)
    rois = [(90.0, 150.0), (200.0, 260.0)]
    filtered = filter_windows_by_roi(windows, rois)
    assert len(filtered) < len(windows)
    assert all(any(max(w[0], r[0]) < min(w[1], r[1]) for r in rois) for w in filtered)


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

"""宫格 Coarse-to-Fine clip 事件检测单元测试。"""
from backend.services.clip_event_detector import (
    COARSE_SAFETY_TILE_EVERY_N,
    COARSE_TILE_FRAMES,
    COARSE_TILE_SIZE_SEC,
    COARSE_TILE_STRIDE_SEC,
    ClipScoreRecord,
    build_coarse_tiles,
    build_sliding_windows,
    coarse_candidates_to_hotspots,
    inject_coarse_safety_tiles,
    merge_clip_scores,
    select_coarse_candidates,
)


def test_build_coarse_tiles_1hour_stride_50():
    tiles = build_coarse_tiles(
        0.0,
        3600.0,
        tile_size=COARSE_TILE_SIZE_SEC,
        stride=COARSE_TILE_STRIDE_SEC,
    )
    assert 68 <= len(tiles) <= 75
    assert tiles[0] == (0.0, 100.0)
    assert tiles[1] == (50.0, 150.0)


def test_coarse_tile_frame_count():
    assert COARSE_TILE_FRAMES == 72


def test_build_sliding_windows_fine_60s():
    windows = build_sliding_windows(0.0, 60.0, window_size=16.0, stride=4.0)
    assert len(windows) >= 12
    assert windows[0] == (0.0, 16.0)


def test_filter_windows_within_hotspots():
    from backend.services.clip_event_detector import filter_windows_within_hotspots

    hotspots = [(100.0, 160.0)]
    windows = [(90.0, 106.0), (200.0, 216.0), (120.0, 136.0)]
    filtered = filter_windows_within_hotspots(windows, hotspots)
    assert (120.0, 136.0) in filtered
    assert (200.0, 216.0) not in filtered


def test_select_coarse_candidates_threshold_or_top_k():
    records = [
        ClipScoreRecord(float(i * 100), float(i * 100 + 100), 0.9 - i * 0.05, False, "")
        for i in range(10)
    ]
    records[3].score = 0.2
    records[8].score = 0.82
    selected = select_coarse_candidates(
        records,
        score_threshold=0.22,
        top_k_ratio=0.45,
        max_tiles=80,
        min_tiles=8,
    )
    assert len(selected) >= 8
    assert any(row.start_sec == 800.0 for row in selected)


def test_inject_coarse_safety_tiles_uniform_coverage():
    records = [
        ClipScoreRecord(float(i * 50), float(i * 50 + 100), 0.1, False, "")
        for i in range(12)
    ]
    selected: dict[tuple[float, float], ClipScoreRecord] = {}
    safety_keys = inject_coarse_safety_tiles(
        records,
        selected,
        every_n=COARSE_SAFETY_TILE_EVERY_N,
    )
    assert len(safety_keys) == 4
    assert len(selected) == 4
    assert (0.0, 100.0) in selected
    assert (150.0, 250.0) in selected


def test_coarse_candidates_to_hotspots_merge_gap():
    candidates = [
        ClipScoreRecord(0.0, 100.0, 0.8, False, ""),
        ClipScoreRecord(100.0, 200.0, 0.7, False, ""),
        ClipScoreRecord(500.0, 600.0, 0.75, False, ""),
    ]
    hotspots = coarse_candidates_to_hotspots(candidates, 0.0, 3600.0, pad_sec=15.0)
    assert len(hotspots) == 2
    assert hotspots[0][0] == 0.0
    assert hotspots[0][1] == 215.0
    assert hotspots[1][0] == 485.0


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

"""信号预筛与验证抽帧单元测试。"""
import struct

from backend.services.editor_moment_search import (
    build_verify_sample_times_for_candidates,
    is_visual_primary_search,
)
from backend.services.moment_signal_prefilter import (
    SignalRegion,
    audio_rms_to_regions,
    cluster_scene_cuts_to_regions,
    compute_rms_windows,
    fuse_weighted_regions,
    merge_signal_regions,
    resolve_criteria_profile,
)


def test_resolve_criteria_profile():
    assert resolve_criteria_profile("找到所有枪战片段") == "gunplay"
    assert resolve_criteria_profile("打斗场面") == "melee"
    assert resolve_criteria_profile("追逐戏") == "chase"
    assert resolve_criteria_profile("动作场面") == "action"


def test_is_visual_primary_includes_gunplay_keywords():
    assert is_visual_primary_search("找交火镜头") is True
    assert is_visual_primary_search("射击场面") is True


def test_cluster_scene_cuts_to_regions():
    cuts = [1.0, 1.4, 1.8, 2.2, 8.0, 8.3, 8.7]
    regions = cluster_scene_cuts_to_regions(
        cuts,
        timeline_start_sec=100.0,
        duration_sec=20.0,
        window_sec=4.0,
        min_cuts=3,
    )
    assert regions
    assert regions[0].start_sec >= 100.0
    assert regions[0].signal == "scene"


def test_merge_signal_regions_merges_close_intervals():
    regions = [
        SignalRegion(10.0, 14.0, 0.6, "motion"),
        SignalRegion(14.5, 18.0, 0.7, "audio"),
    ]
    merged = merge_signal_regions(regions, gap_sec=1.5)
    assert len(merged) == 1
    assert merged[0].end_sec == 18.0


def test_fuse_weighted_regions_multi_signal_bonus():
    scene = [SignalRegion(0.0, 5.0, 0.8, "scene")]
    audio = [SignalRegion(1.0, 6.0, 0.7, "audio")]
    motion = [SignalRegion(2.0, 7.0, 0.9, "motion")]
    fused = fuse_weighted_regions(scene, audio, motion, profile="gunplay", recall_mode="high")
    assert fused
    assert fused[0][2] > 0.2
    assert "预筛" in fused[0][3]


def test_compute_rms_windows_and_audio_regions():
    samples = []
    for index in range(16000):
        amplitude = 8000 if 4000 <= index < 5200 else 200
        samples.append(amplitude)
    pcm = struct.pack(f"<{len(samples)}h", *samples)
    windows = compute_rms_windows(pcm, sample_rate=8000, window_sec=0.25, hop_sec=0.125)
    assert len(windows) > 10
    regions = audio_rms_to_regions(
        windows,
        timeline_start_sec=50.0,
        duration_sec=10.0,
        recall_mode="high",
    )
    assert regions
    assert regions[0].start_sec >= 50.0


def test_build_verify_sample_times_for_candidates():
    candidates = [
        (10.0, 20.0, 0.9, "预筛(motion+audio)"),
        (100.0, 110.0, 0.7, "预筛(scene)"),
    ]
    times = build_verify_sample_times_for_candidates(
        candidates,
        timeline_start_sec=0.0,
        duration_sec=600.0,
        recall_mode="balanced",
    )
    assert 3 <= len(times) <= 80
    inside = [value for value in times if 10.0 < value < 20.0]
    assert len(inside) >= 2

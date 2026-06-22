"""画面类片段检索：scene / 音频能量 / 运动帧差预筛，供后续 LLM 抽帧验证。"""
from __future__ import annotations

import logging
import math
import re
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from backend.utils.ffmpeg_utils import get_ffmpeg_path

logger = logging.getLogger(__name__)

RecallMode = Literal["balanced", "high"]

GUNPLAY_CRITERIA = re.compile(r"枪战|交火|射击|火力|枪声|开火")
MELEE_CRITERIA = re.compile(r"打斗|打架|格斗|搏击|武打|搏斗|对打|械斗|拳脚")
CHASE_CRITERIA = re.compile(r"追逐|追赶|飙车|逃跑|追逃")

PROFILE_WEIGHTS: Dict[str, Dict[str, float]] = {
    "action": {"scene": 0.25, "audio": 0.35, "motion": 0.40},
    "gunplay": {"scene": 0.30, "audio": 0.40, "motion": 0.30},
    "melee": {"scene": 0.20, "audio": 0.30, "motion": 0.50},
    "chase": {"scene": 0.25, "audio": 0.25, "motion": 0.50},
}

MOTION_FRAME_W = 160
MOTION_FRAME_H = 90
MOTION_FPS = 2.0
AUDIO_SAMPLE_RATE = 8000
AUDIO_WINDOW_SEC = 0.25
AUDIO_HOP_SEC = 0.125

SCENE_CLUSTER_WINDOW_SEC = 4.0
SCENE_MIN_CUTS = 3
REGION_MERGE_GAP_SEC = 1.5
MAX_CANDIDATE_WINDOWS = 24


@dataclass
class SignalRegion:
    start_sec: float
    end_sec: float
    score: float
    signal: str


def resolve_criteria_profile(search_criteria: str) -> str:
    text = (search_criteria or "").strip()
    if GUNPLAY_CRITERIA.search(text):
        return "gunplay"
    if MELEE_CRITERIA.search(text):
        return "melee"
    if CHASE_CRITERIA.search(text):
        return "chase"
    return "action"


def resolve_block_video_path(project_dir: Path, block: Dict[str, Any]) -> Optional[Path]:
    media = block.get("media") or {}
    rel_path = str(media.get("path") or "").strip()
    if not rel_path:
        return None
    video_path = project_dir / rel_path
    if not video_path.exists():
        return None
    return video_path


def resolve_block_trim_window(block: Dict[str, Any]) -> Tuple[float, float]:
    trim = block.get("trim") or {}
    trim_in = float(trim.get("in_sec") or 0)
    trim_out = float(trim.get("out_sec") or trim_in)
    if trim_out <= trim_in:
        duration = float(block.get("duration_sec") or 0)
        trim_out = trim_in + max(duration, 0.1)
    return trim_in, trim_out


def cluster_scene_cuts_to_regions(
    cut_times_rel: Sequence[float],
    *,
    timeline_start_sec: float,
    duration_sec: float,
    window_sec: float = SCENE_CLUSTER_WINDOW_SEC,
    min_cuts: int = SCENE_MIN_CUTS,
    pad_sec: float = 2.0,
) -> List[SignalRegion]:
    if not cut_times_rel:
        return []
    ordered = sorted(float(value) for value in cut_times_rel)
    duration = max(0.1, duration_sec)
    regions: List[SignalRegion] = []
    step = max(1.0, window_sec * 0.5)
    cursor = 0.0
    while cursor < duration:
        win_end = min(duration, cursor + window_sec)
        cuts = [value for value in ordered if cursor <= value < win_end]
        if len(cuts) >= min_cuts:
            density = len(cuts) / max(0.1, win_end - cursor)
            score = min(1.0, density / 1.2)
            tl_start = timeline_start_sec + max(0.0, cursor - pad_sec)
            tl_end = timeline_start_sec + min(duration, win_end + pad_sec)
            regions.append(
                SignalRegion(
                    start_sec=tl_start,
                    end_sec=tl_end,
                    score=score,
                    signal="scene",
                )
            )
        cursor += step
    return merge_signal_regions(regions, gap_sec=REGION_MERGE_GAP_SEC)


def detect_scene_cut_times(
    video_path: Path,
    trim_in: float,
    duration_sec: float,
    *,
    scene_threshold: float = 0.35,
) -> List[float]:
    ffmpeg = get_ffmpeg_path()
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "info",
        "-ss",
        f"{trim_in:.3f}",
        "-i",
        str(video_path),
        "-t",
        f"{max(0.1, duration_sec):.3f}",
        "-vf",
        f"select='gt(scene\\,{scene_threshold})',showinfo",
        "-vsync",
        "vfr",
        "-an",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=max(120, int(duration_sec * 0.5) + 30),
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("场景切镜检测失败: %s", exc)
        return []

    stderr = result.stderr or ""
    cut_times: List[float] = []
    for line in stderr.splitlines():
        if "pts_time:" not in line:
            continue
        try:
            fragment = line.split("pts_time:")[-1].strip().split()[0]
            cut_times.append(float(fragment))
        except (ValueError, IndexError):
            continue
    return sorted(set(cut_times))


def _extract_mono_pcm(
    video_path: Path,
    trim_in: float,
    duration_sec: float,
    *,
    sample_rate: int = AUDIO_SAMPLE_RATE,
) -> bytes:
    ffmpeg = get_ffmpeg_path()
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{trim_in:.3f}",
        "-i",
        str(video_path),
        "-t",
        f"{max(0.1, duration_sec):.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "-",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=max(90, int(duration_sec * 0.4) + 30),
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("音频 PCM 提取失败: %s", exc)
        return b""
    if result.returncode != 0:
        logger.warning("音频 PCM 提取 stderr: %s", (result.stderr or b"")[:200])
        return b""
    return result.stdout or b""


def compute_rms_windows(
    pcm_bytes: bytes,
    *,
    sample_rate: int = AUDIO_SAMPLE_RATE,
    window_sec: float = AUDIO_WINDOW_SEC,
    hop_sec: float = AUDIO_HOP_SEC,
) -> List[Tuple[float, float]]:
    if len(pcm_bytes) < 4:
        return []
    sample_count = len(pcm_bytes) // 2
    samples = struct.unpack(f"<{sample_count}h", pcm_bytes[: sample_count * 2])
    window = max(1, int(sample_rate * window_sec))
    hop = max(1, int(sample_rate * hop_sec))
    rows: List[Tuple[float, float]] = []
    for start in range(0, max(1, len(samples) - window + 1), hop):
        chunk = samples[start : start + window]
        if not chunk:
            continue
        rms = math.sqrt(sum(value * value for value in chunk) / len(chunk))
        db = 20.0 * math.log10(rms / 32768.0) if rms > 1.0 else -80.0
        rows.append((start / sample_rate, db))
    return rows


def audio_rms_to_regions(
    rms_windows: Sequence[Tuple[float, float]],
    *,
    timeline_start_sec: float,
    duration_sec: float,
    recall_mode: RecallMode,
    pad_sec: float = 0.75,
) -> List[SignalRegion]:
    if not rms_windows:
        return []
    values = [row[1] for row in rms_windows]
    sorted_values = sorted(values)
    median = sorted_values[len(sorted_values) // 2]
    delta = 6.0 if recall_mode == "high" else 8.0
    threshold = median + delta
    peak_indices = [index for index, (_, db) in enumerate(rms_windows) if db >= threshold]
    if not peak_indices:
        top_count = max(1, len(rms_windows) // 20)
        peak_indices = sorted(
            range(len(rms_windows)),
            key=lambda index: rms_windows[index][1],
            reverse=True,
        )[:top_count]
        peak_indices.sort()

    regions: List[SignalRegion] = []
    if not peak_indices:
        return regions

    group_start = peak_indices[0]
    group_end = peak_indices[0]
    peak_scores: List[float] = [rms_windows[group_start][1]]

    def flush_group(start_idx: int, end_idx: int, scores: List[float]) -> None:
        rel_start = rms_windows[start_idx][0]
        rel_end = rms_windows[end_idx][0] + AUDIO_WINDOW_SEC
        peak_db = max(scores)
        score = min(1.0, max(0.0, (peak_db - median) / 20.0))
        regions.append(
            SignalRegion(
                start_sec=timeline_start_sec + max(0.0, rel_start - pad_sec),
                end_sec=timeline_start_sec + min(duration_sec, rel_end + pad_sec),
                score=score,
                signal="audio",
            )
        )

    for index in peak_indices[1:]:
        prev_time = rms_windows[group_end][0]
        cur_time = rms_windows[index][0]
        if cur_time - prev_time <= 1.0:
            group_end = index
            peak_scores.append(rms_windows[index][1])
        else:
            flush_group(group_start, group_end, peak_scores)
            group_start = index
            group_end = index
            peak_scores = [rms_windows[index][1]]
    flush_group(group_start, group_end, peak_scores)
    return merge_signal_regions(regions, gap_sec=REGION_MERGE_GAP_SEC)


def detect_motion_regions(
    video_path: Path,
    trim_in: float,
    duration_sec: float,
    *,
    timeline_start_sec: float,
    recall_mode: RecallMode,
) -> List[SignalRegion]:
    ffmpeg = get_ffmpeg_path()
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{trim_in:.3f}",
        "-i",
        str(video_path),
        "-t",
        f"{max(0.1, duration_sec):.3f}",
        "-an",
        "-vf",
        f"fps={MOTION_FPS},scale={MOTION_FRAME_W}:{MOTION_FRAME_H},format=gray",
        "-f",
        "rawvideo",
        "-",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=max(120, int(duration_sec * 0.6) + 30),
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("运动帧差分析失败: %s", exc)
        return []

    raw = result.stdout or b""
    frame_size = MOTION_FRAME_W * MOTION_FRAME_H
    if len(raw) < frame_size * 2:
        return []

    frame_count = len(raw) // frame_size
    scores: List[Tuple[float, float]] = []
    prev = raw[:frame_size]
    for index in range(1, frame_count):
        cur = raw[index * frame_size : (index + 1) * frame_size]
        if len(cur) != frame_size:
            break
        diff = sum(
            1 for left, right in zip(prev, cur) if abs(left - right) > 18
        ) / frame_size
        time_rel = index / MOTION_FPS
        scores.append((time_rel, diff))
        prev = cur

    if not scores:
        return []

    sorted_scores = sorted(value for _, value in scores)
    percentile_index = int(len(sorted_scores) * (0.80 if recall_mode == "high" else 0.85))
    threshold = sorted_scores[min(len(sorted_scores) - 1, percentile_index)]

    regions: List[SignalRegion] = []
    active_start: Optional[float] = None
    active_peak = 0.0
    for time_rel, value in scores:
        if value >= threshold:
            if active_start is None:
                active_start = time_rel
                active_peak = value
            else:
                active_peak = max(active_peak, value)
        elif active_start is not None:
            regions.append(
                SignalRegion(
                    start_sec=timeline_start_sec + max(0.0, active_start - 1.0),
                    end_sec=timeline_start_sec + min(duration_sec, time_rel + 1.0),
                    score=min(1.0, active_peak * 2.5),
                    signal="motion",
                )
            )
            active_start = None
            active_peak = 0.0
    if active_start is not None:
        regions.append(
            SignalRegion(
                start_sec=timeline_start_sec + max(0.0, active_start - 1.0),
                end_sec=timeline_start_sec + min(duration_sec, duration_sec),
                score=min(1.0, active_peak * 2.5),
                signal="motion",
            )
        )
    return merge_signal_regions(regions, gap_sec=REGION_MERGE_GAP_SEC)


def merge_signal_regions(
    regions: Sequence[SignalRegion],
    *,
    gap_sec: float = REGION_MERGE_GAP_SEC,
) -> List[SignalRegion]:
    if not regions:
        return []
    ordered = sorted(regions, key=lambda item: item.start_sec)
    merged: List[SignalRegion] = []
    cur = SignalRegion(
        start_sec=ordered[0].start_sec,
        end_sec=ordered[0].end_sec,
        score=ordered[0].score,
        signal=ordered[0].signal,
    )
    for region in ordered[1:]:
        if region.start_sec <= cur.end_sec + gap_sec:
            cur.end_sec = max(cur.end_sec, region.end_sec)
            cur.score = max(cur.score, region.score)
            if region.signal not in cur.signal:
                cur.signal = f"{cur.signal}+{region.signal}"
        else:
            merged.append(cur)
            cur = SignalRegion(
                start_sec=region.start_sec,
                end_sec=region.end_sec,
                score=region.score,
                signal=region.signal,
            )
    merged.append(cur)
    return merged


def fuse_weighted_regions(
    scene_regions: Sequence[SignalRegion],
    audio_regions: Sequence[SignalRegion],
    motion_regions: Sequence[SignalRegion],
    *,
    profile: str,
    recall_mode: RecallMode,
) -> List[Tuple[float, float, float, str]]:
    weights = PROFILE_WEIGHTS.get(profile, PROFILE_WEIGHTS["action"])
    tagged: List[SignalRegion] = []
    for region in scene_regions:
        tagged.append(
            SignalRegion(
                start_sec=region.start_sec,
                end_sec=region.end_sec,
                score=region.score * weights["scene"],
                signal="scene",
            )
        )
    for region in audio_regions:
        tagged.append(
            SignalRegion(
                start_sec=region.start_sec,
                end_sec=region.end_sec,
                score=region.score * weights["audio"],
                signal="audio",
            )
        )
    for region in motion_regions:
        tagged.append(
            SignalRegion(
                start_sec=region.start_sec,
                end_sec=region.end_sec,
                score=region.score * weights["motion"],
                signal="motion",
            )
        )
    if not tagged:
        return []

    merged = merge_signal_regions(tagged, gap_sec=REGION_MERGE_GAP_SEC)
    min_score = 0.18 if recall_mode == "high" else 0.24
    scored: List[Tuple[float, float, float, str]] = []
    for region in merged:
        if region.score < min_score:
            continue
        signals = region.signal.split("+")
        bonus = 0.06 * max(0, len(set(signals)) - 1)
        final_score = min(1.0, region.score + bonus)
        reason = f"预筛({'+'.join(sorted(set(signals)))})"
        scored.append((region.start_sec, region.end_sec, final_score, reason))
    scored.sort(key=lambda row: row[2], reverse=True)
    return scored[:MAX_CANDIDATE_WINDOWS]


def build_moment_candidate_windows(
    project_dir: Path,
    block: Dict[str, Any],
    timeline_start_sec: float,
    duration_sec: float,
    search_criteria: str,
    *,
    recall_mode: RecallMode = "balanced",
    visual_profile: Optional[str] = None,
) -> List[Tuple[float, float, float, str]]:
    """返回 timeline 坐标候选区间 (start, end, score, reason)，不含 LLM 结论。"""
    video_path = resolve_block_video_path(project_dir, block)
    if video_path is None:
        return []

    trim_in, trim_out = resolve_block_trim_window(block)
    duration = max(0.1, min(duration_sec, trim_out - trim_in))
    profile = (visual_profile or "").strip() or resolve_criteria_profile(search_criteria)
    if profile not in PROFILE_WEIGHTS:
        profile = resolve_criteria_profile(search_criteria)

    scene_regions: List[SignalRegion] = []
    audio_regions: List[SignalRegion] = []
    motion_regions: List[SignalRegion] = []

    try:
        cut_times = detect_scene_cut_times(video_path, trim_in, duration)
        scene_regions = cluster_scene_cuts_to_regions(
            cut_times,
            timeline_start_sec=timeline_start_sec,
            duration_sec=duration,
        )
    except Exception as exc:
        logger.warning("场景预筛异常: %s", exc)

    try:
        pcm = _extract_mono_pcm(video_path, trim_in, duration)
        rms_windows = compute_rms_windows(pcm)
        audio_regions = audio_rms_to_regions(
            rms_windows,
            timeline_start_sec=timeline_start_sec,
            duration_sec=duration,
            recall_mode=recall_mode,
        )
    except Exception as exc:
        logger.warning("音频预筛异常: %s", exc)

    try:
        motion_regions = detect_motion_regions(
            video_path,
            trim_in,
            duration,
            timeline_start_sec=timeline_start_sec,
            recall_mode=recall_mode,
        )
    except Exception as exc:
        logger.warning("运动预筛异常: %s", exc)

    return fuse_weighted_regions(
        scene_regions,
        audio_regions,
        motion_regions,
        profile=profile,
        recall_mode=recall_mode,
    )

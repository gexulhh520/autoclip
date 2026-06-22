"""统一 Pipeline：LLM Planner → 宫格粗筛 → 精扫 → 时间段合并。"""
from __future__ import annotations

import base64
import json
import logging
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from backend.services.clip_search_planner import ClipSearchSpec, plan_clip_search
from backend.services.editor_moment_search import (
    MatchedMoment,
    build_matched_moments_from_timeline_ranges,
    merge_matched_moments,
    timeline_sample_to_source_sec,
)
from backend.services.moment_signal_prefilter import resolve_block_video_path
from backend.utils.ffmpeg_utils import get_ffmpeg_path

logger = logging.getLogger(__name__)

# --- Fine（精扫，保持不变）---
FINE_WINDOW_SEC = 16.0
FINE_STRIDE_SEC = 4.0
FINE_STRIDE_HIGH_RECALL_SEC = 2.0
FINE_FPS = 3.0
FINE_FRAMES = 48
FINE_INCLUDE_AUDIO = True
MAX_FINE_WINDOWS_CAP = 200

# --- Coarse（宫格稀疏评分）---
COARSE_TILE_SIZE_SEC = 100.0
COARSE_TILE_STRIDE_SEC = 100.0
COARSE_TILE_SIZE_HIGH_RECALL_SEC = 90.0
COARSE_TILE_STRIDE_HIGH_RECALL_SEC = 90.0
COARSE_TILE_FRAMES = 9
COARSE_TILE_MAX_WIDTH = 360
COARSE_PARALLEL_WORKERS = 2
COARSE_SALIENCY_THRESHOLD_BALANCED = 0.35
COARSE_SALIENCY_THRESHOLD_HIGH = 0.28
COARSE_TOP_K_RATIO = 0.2
COARSE_MAX_TILES = 40
COARSE_MIN_TILES = 3
TILE_HOTSPOT_MERGE_GAP_SEC = 10.0
HOTSPOT_PAD_SEC = 15.0
SKIP_COARSE_DURATION_SEC = 180.0

FRAME_MAX_WIDTH = 480
SCORE_THRESHOLD_BALANCED = 0.7
SCORE_THRESHOLD_HIGH = 0.6
MERGE_GAP_SEC = 8.0

COARSE_SALIENCY_SYSTEM = """你是视频宫格稀疏评分助手。

用户目标：{user_query}

你将看到一段约 {tile_sec:.0f} 秒的视频稀疏画面帧。

请不要判断是否已经满足用户目标。

你的任务是判断：这段视频是否「值得进一步分析」，是否可能包含与用户目标相关的线索。

请重点关注：
- 人物是否发生互动或变化
- 情绪是否发生变化
- 动作是否明显变化
- 场景是否发生变化
- 是否存在剧情推进点

只输出 JSON：
{{
  "score": 0-1
}}

score 越高表示越值得精扫；静态无关画面应接近 0。"""

CLIP_CLASSIFIER_SYSTEM = """你是视频 clip 精筛确认器。

请严格判断用户提供的 16 秒片段是否「明确包含用户目标」。

要求：
- 必须有直接视觉或音频证据
- 不允许推测或泛化
- 不确定必须判 false

只输出 JSON：
{
  "is_event": true/false,
  "score": 0-1,
  "summary": "一句话描述发生内容"
}"""


@dataclass
class ClipScoreRecord:
    start_sec: float
    end_sec: float
    score: float
    is_event: bool
    summary: str = ""


@dataclass
class ClipEventSearchMeta:
    engine: str = "clip_tile_coarse_fine_v2"
    coarse_windows: int = 0
    fine_windows: int = 0
    note_parts: List[str] = field(default_factory=list)


def build_sliding_windows(
    timeline_start_sec: float,
    duration_sec: float,
    *,
    window_size: float = FINE_WINDOW_SEC,
    stride: float = FINE_STRIDE_SEC,
) -> List[Tuple[float, float]]:
    duration = max(0.1, float(duration_sec))
    start_base = float(timeline_start_sec)
    windows: List[Tuple[float, float]] = []
    offset = 0.0
    while offset < duration:
        win_end_offset = min(duration, offset + window_size)
        if win_end_offset - offset < max(1.0, window_size * 0.25):
            break
        windows.append((start_base + offset, start_base + win_end_offset))
        if win_end_offset >= duration:
            break
        offset += stride
    return windows


def build_coarse_tiles(
    timeline_start_sec: float,
    duration_sec: float,
    *,
    tile_size: float = COARSE_TILE_SIZE_SEC,
    stride: float = COARSE_TILE_STRIDE_SEC,
) -> List[Tuple[float, float]]:
    """宫格切分：非重叠/低重叠大块，显著少于旧 60s 滑窗。"""
    return build_sliding_windows(
        timeline_start_sec,
        duration_sec,
        window_size=tile_size,
        stride=stride,
    )


def select_coarse_candidates(
    records: List[ClipScoreRecord],
    *,
    score_threshold: float,
    top_k_ratio: float = COARSE_TOP_K_RATIO,
    max_tiles: int = COARSE_MAX_TILES,
    min_tiles: int = COARSE_MIN_TILES,
) -> List[ClipScoreRecord]:
    """Top-K + 阈值：先过阈值，再取分数最高的前 K 格（粗筛只做筛选）。"""
    if not records:
        return []

    qualified = [row for row in records if float(row.score) >= score_threshold]
    k = min(max_tiles, max(min_tiles, int(len(records) * top_k_ratio + 0.999)))

    if qualified:
        selected = sorted(qualified, key=lambda item: item.score, reverse=True)[:k]
    else:
        selected = sorted(records, key=lambda item: item.score, reverse=True)[
            : min(min_tiles, max_tiles)
        ]

    return sorted(selected, key=lambda item: item.start_sec)


def coarse_candidates_to_hotspots(
    candidates: List[ClipScoreRecord],
    timeline_start_sec: float,
    timeline_end_sec: float,
    *,
    merge_gap_sec: float = TILE_HOTSPOT_MERGE_GAP_SEC,
    pad_sec: float = HOTSPOT_PAD_SEC,
) -> List[Tuple[float, float]]:
    """相邻宫格（gap ≤ 10s）合并为 hotspot，前后 padding 供精扫。"""
    if not candidates:
        return []

    ordered = sorted(candidates, key=lambda item: item.start_sec)
    merged: List[Tuple[float, float]] = []
    cur_start = ordered[0].start_sec
    cur_end = ordered[0].end_sec

    for row in ordered[1:]:
        gap = row.start_sec - cur_end
        if gap <= merge_gap_sec:
            cur_end = max(cur_end, row.end_sec)
        else:
            merged.append((cur_start, cur_end))
            cur_start = row.start_sec
            cur_end = row.end_sec
    merged.append((cur_start, cur_end))

    padded: List[Tuple[float, float]] = []
    for start, end in merged:
        padded.append(
            (
                max(timeline_start_sec, start - pad_sec),
                min(timeline_end_sec, end + pad_sec),
            )
        )
    return merge_roi_regions(padded, gap_sec=0.0)


def merge_roi_regions(
    regions: List[Tuple[float, float]],
    *,
    gap_sec: float = 1.0,
) -> List[Tuple[float, float]]:
    if not regions:
        return []
    ordered = sorted(regions, key=lambda item: item[0])
    merged: List[Tuple[float, float]] = [ordered[0]]
    for start, end in ordered[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end <= gap_sec:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def build_fine_windows_in_hotspots(
    hotspots: List[Tuple[float, float]],
    *,
    window_size: float = FINE_WINDOW_SEC,
    stride: float = FINE_STRIDE_SEC,
) -> List[Tuple[float, float]]:
    windows: List[Tuple[float, float]] = []
    for h_start, h_end in hotspots:
        span = max(0.1, h_end - h_start)
        windows.extend(
            build_sliding_windows(h_start, span, window_size=window_size, stride=stride)
        )
    if not windows:
        return []
    windows.sort(key=lambda item: item[0])
    deduped: List[Tuple[float, float]] = [windows[0]]
    for start, end in windows[1:]:
        prev_start, prev_end = deduped[-1]
        if abs(start - prev_start) < 0.5 and abs(end - prev_end) < 0.5:
            continue
        deduped.append((start, end))
    return filter_windows_within_hotspots(deduped, hotspots)


def filter_windows_within_hotspots(
    windows: List[Tuple[float, float]],
    hotspots: List[Tuple[float, float]],
    *,
    min_overlap_sec: float = 4.0,
) -> List[Tuple[float, float]]:
    """确保精扫窗与粗筛热点有足够重叠，避免看起来像在扫全片。"""
    if not hotspots or not windows:
        return windows
    filtered: List[Tuple[float, float]] = []
    for win_start, win_end in windows:
        for hs, he in hotspots:
            overlap = min(win_end, he) - max(win_start, hs)
            if overlap >= min_overlap_sec:
                filtered.append((win_start, win_end))
                break
    return filtered


def score_record_to_dict(record: ClipScoreRecord) -> Dict[str, Any]:
    return {
        "start_sec": round(record.start_sec, 2),
        "end_sec": round(record.end_sec, 2),
        "score": round(record.score, 3),
        "is_event": record.is_event,
        "summary": record.summary,
    }


def region_to_dict(start: float, end: float) -> Dict[str, float]:
    return {"start_sec": round(start, 2), "end_sec": round(end, 2)}


def _run_coarse_tile(
    llm_manager: Any,
    video_path: Path,
    block: Dict[str, Any],
    spec: ClipSearchSpec,
    *,
    timeline_start_sec: float,
    duration: float,
    tile_start: float,
    tile_end: float,
    tile_fps: float,
) -> ClipScoreRecord:
    clip_duration = max(0.1, tile_end - tile_start)
    source_start = timeline_sample_to_source_sec(
        block, timeline_start_sec, duration, tile_start
    )
    frames = _extract_clip_frames(
        video_path,
        source_start,
        clip_duration,
        fps=tile_fps,
        max_frames=COARSE_TILE_FRAMES,
        max_width=COARSE_TILE_MAX_WIDTH,
    )
    if not frames:
        return ClipScoreRecord(tile_start, tile_end, 0.0, False, "")
    return score_tile_saliency(
        llm_manager,
        spec,
        frames,
        clip_meta={"start_sec": tile_start, "end_sec": tile_end},
        tile_sec=clip_duration,
    )


def merge_clip_scores(
    records: List[ClipScoreRecord],
    *,
    score_threshold: float = SCORE_THRESHOLD_BALANCED,
    merge_gap_sec: float = MERGE_GAP_SEC,
) -> List[Tuple[float, float, float, str]]:
    if not records:
        return []

    valid = [
        row
        for row in records
        if row.is_event and float(row.score) >= score_threshold
    ]
    if not valid:
        return []

    ordered = sorted(valid, key=lambda item: item.start_sec)
    merged: List[Tuple[float, float, float, str]] = []
    cur_start = ordered[0].start_sec
    cur_end = ordered[0].end_sec
    scores = [ordered[0].score]
    summaries = [ordered[0].summary]

    for row in ordered[1:]:
        gap = row.start_sec - cur_end
        overlaps = row.start_sec <= cur_end
        if overlaps or gap <= merge_gap_sec:
            cur_end = max(cur_end, row.end_sec)
            scores.append(row.score)
            if row.summary:
                summaries.append(row.summary)
        else:
            merged.append(
                (
                    cur_start,
                    cur_end,
                    sum(scores) / len(scores),
                    summaries[0] if summaries else "",
                )
            )
            cur_start = row.start_sec
            cur_end = row.end_sec
            scores = [row.score]
            summaries = [row.summary] if row.summary else []

    merged.append(
        (
            cur_start,
            cur_end,
            sum(scores) / len(scores),
            summaries[0] if summaries else "",
        )
    )
    return merged


def _extract_clip_frames(
    video_path: Path,
    source_start_sec: float,
    clip_duration_sec: float,
    *,
    fps: float = FINE_FPS,
    max_width: int = FRAME_MAX_WIDTH,
    max_frames: int = FINE_FRAMES,
) -> List[str]:
    ffmpeg = get_ffmpeg_path()
    out_dir = Path(tempfile.mkdtemp(prefix="autoclip_clip_frames_"))
    pattern = out_dir / "frame_%04d.jpg"
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{max(0.0, source_start_sec):.3f}",
        "-t",
        f"{max(0.1, clip_duration_sec):.3f}",
        "-i",
        str(video_path),
        "-an",
        "-vf",
        f"fps={fps},scale='min({max_width},iw)':-2",
        "-frames:v",
        str(max_frames),
        "-q:v",
        "4",
        str(pattern),
    ]
    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            timeout=max(120, int(clip_duration_sec * 4) + 30),
        )
        frames: List[str] = []
        for path in sorted(out_dir.glob("frame_*.jpg")):
            if not path.exists() or path.stat().st_size <= 0:
                continue
            frames.append(base64.b64encode(path.read_bytes()).decode("ascii"))
            if len(frames) >= max_frames:
                break
        return frames
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("clip 抽帧失败 @%.2fs: %s", source_start_sec, exc)
        return []
    finally:
        for path in out_dir.glob("*"):
            try:
                path.unlink()
            except OSError:
                pass
        try:
            out_dir.rmdir()
        except OSError:
            pass


def _extract_clip_audio_wav_b64(
    video_path: Path,
    source_start_sec: float,
    clip_duration_sec: float,
) -> Optional[str]:
    ffmpeg = get_ffmpeg_path()
    out_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            out_path = Path(tmp.name)
        cmd = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{max(0.0, source_start_sec):.3f}",
            "-t",
            f"{max(0.1, min(clip_duration_sec, 16.0)):.3f}",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            str(out_path),
        ]
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            timeout=max(60, int(clip_duration_sec * 2) + 20),
        )
        if not out_path.exists() or out_path.stat().st_size <= 44:
            return None
        return base64.b64encode(out_path.read_bytes()).decode("ascii")
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("clip 音频提取失败 @%.2fs: %s", source_start_sec, exc)
        return None
    finally:
        if out_path and out_path.exists():
            try:
                out_path.unlink()
            except OSError:
                pass


def _classify_clip_internal(
    llm_manager: Any,
    search_spec: ClipSearchSpec,
    frame_b64_list: List[str],
    *,
    system_prompt: str,
    audio_wav_b64: Optional[str] = None,
    clip_meta: Optional[Dict[str, Any]] = None,
    user_message: str,
) -> ClipScoreRecord:
    meta = clip_meta or {}
    start_sec = float(meta.get("start_sec") or 0)
    end_sec = float(meta.get("end_sec") or start_sec)
    if not frame_b64_list:
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    images: List[str] = []
    if audio_wav_b64:
        images.append(audio_wav_b64)
    images.extend(frame_b64_list)

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": user_message,
            "images": images,
        },
    ]
    try:
        response = llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=512,
            num_ctx=65536,
            timeout=300,
            temperature=0.15,
        )
        parsed = llm_manager.parse_json_response(response.content or "")
    except Exception as exc:
        logger.warning("clip 精筛失败 %.1f-%.1fs: %s", start_sec, end_sec, exc)
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    if not isinstance(parsed, dict):
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    score = float(parsed.get("score") or 0)
    is_event = bool(parsed.get("is_event"))
    if not is_event and score >= 0.75:
        is_event = True
    if is_event and score < 0.35:
        is_event = False

    summary = str(parsed.get("summary") or "").strip()
    return ClipScoreRecord(start_sec, end_sec, score, is_event, summary)


def score_tile_saliency(
    llm_manager: Any,
    search_spec: ClipSearchSpec,
    frame_b64_list: List[str],
    *,
    clip_meta: Optional[Dict[str, Any]] = None,
    tile_sec: float = COARSE_TILE_SIZE_SEC,
) -> ClipScoreRecord:
    meta = clip_meta or {}
    start_sec = float(meta.get("start_sec") or 0)
    end_sec = float(meta.get("end_sec") or start_sec)
    if not frame_b64_list:
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    user_query = (search_spec.search_description or search_spec.user_query or "").strip()
    system_prompt = COARSE_SALIENCY_SYSTEM.format(
        user_query=user_query,
        tile_sec=tile_sec,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"用户目标：{user_query}\n\n"
                f"你将看到约 {tile_sec:.0f} 秒片段的 {len(frame_b64_list)} 张稀疏画面帧。"
                f"只输出 JSON。"
            ),
            "images": frame_b64_list,
        },
    ]
    try:
        response = llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=64,
            num_ctx=16384,
            timeout=120,
            temperature=0.15,
        )
        parsed = llm_manager.parse_json_response(response.content or "")
    except Exception as exc:
        logger.warning("宫格评分失败 %.1f-%.1fs: %s", start_sec, end_sec, exc)
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    if not isinstance(parsed, dict):
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    score = float(parsed.get("score") or parsed.get("confidence") or 0)
    score = max(0.0, min(1.0, score))
    return ClipScoreRecord(start_sec, end_sec, score, False, "")


def classify_clip(
    llm_manager: Any,
    search_spec: ClipSearchSpec,
    frame_b64_list: List[str],
    *,
    audio_wav_b64: Optional[str] = None,
    clip_meta: Optional[Dict[str, Any]] = None,
) -> ClipScoreRecord:
    user_query = (search_spec.search_description or search_spec.user_query or "").strip()
    payload = search_spec.classifier_payload()
    meta = clip_meta or {}
    user_message = (
        f"用户目标：{user_query}\n\n"
        f"你将看到一段 16 秒视频及音频（若有）。\n\n"
        f"检索规范 JSON：\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        f"clip 时间：{meta.get('start_sec')}–{meta.get('end_sec')}s\n\n"
        f"请严格判断是否明确包含用户目标。只输出 JSON。"
    )
    return _classify_clip_internal(
        llm_manager,
        search_spec,
        frame_b64_list,
        system_prompt=CLIP_CLASSIFIER_SYSTEM,
        audio_wav_b64=audio_wav_b64,
        clip_meta=clip_meta,
        user_message=user_message,
    )


def _records_to_moments(
    block: Dict[str, Any],
    timeline_start_sec: float,
    duration_sec: float,
    records: List[ClipScoreRecord],
    *,
    score_threshold: float,
    max_results: int,
) -> List[MatchedMoment]:
    ranges = merge_clip_scores(records, score_threshold=score_threshold)
    moments = build_matched_moments_from_timeline_ranges(
        block,
        timeline_start_sec,
        duration_sec,
        ranges,
        "visual_clip",
    )
    return merge_matched_moments(moments, max_results)


def _coarse_fps_for_tile(tile_sec: float, frame_count: int) -> float:
    return max(0.1, frame_count / max(1.0, tile_sec))


def iter_clip_event_search(
    llm_manager: Any,
    project_dir: Path,
    block: Dict[str, Any],
    search_criteria: str,
    timeline_start_sec: float,
    duration_sec: float,
    max_results: int,
    *,
    recall_mode: str = "balanced",
    include_audio: bool = True,
    search_spec: Optional[ClipSearchSpec] = None,
) -> Iterator[Dict[str, Any]]:
    """Planner → 粗扫 → 精扫；渐进 NDJSON。"""
    user_query = (search_criteria or "").strip()
    duration = max(0.1, float(duration_sec))
    timeline_end = timeline_start_sec + duration
    high_recall = str(recall_mode or "balanced") == "high"
    fine_stride = FINE_STRIDE_HIGH_RECALL_SEC if high_recall else FINE_STRIDE_SEC
    fine_threshold = SCORE_THRESHOLD_HIGH if high_recall else SCORE_THRESHOLD_BALANCED
    coarse_tile_size = COARSE_TILE_SIZE_HIGH_RECALL_SEC if high_recall else COARSE_TILE_SIZE_SEC
    coarse_tile_stride = COARSE_TILE_STRIDE_HIGH_RECALL_SEC if high_recall else COARSE_TILE_STRIDE_SEC
    coarse_threshold = (
        COARSE_SALIENCY_THRESHOLD_HIGH if high_recall else COARSE_SALIENCY_THRESHOLD_BALANCED
    )
    coarse_enabled = duration > SKIP_COARSE_DURATION_SEC

    video_path = resolve_block_video_path(project_dir, block)
    if video_path is None:
        yield {"type": "error", "message": "无法定位片段视频文件"}
        yield {
            "type": "done",
            "block_id": str(block.get("id") or ""),
            "search_criteria": user_query,
            "transcript_source": "none",
            "transcript_segment_count": 0,
            "visual_frame_count": 0,
            "matches": [],
            "note": "无法定位片段视频文件",
        }
        return

    yield {
        "type": "progress",
        "scan_phase": "planner",
        "message": "理解检索目标…",
    }

    spec = search_spec or plan_clip_search(llm_manager, user_query)
    yield {"type": "search_spec", "spec": spec.to_dict()}

    meta = ClipEventSearchMeta()
    meta.note_parts.append(f"Planner：{spec.target} — {spec.display_label()}")
    total_frames = 0
    fine_records: List[ClipScoreRecord] = []
    fine_windows: List[Tuple[float, float]] = []
    coarse_tiles: List[Tuple[float, float]] = []
    coarse_records: List[ClipScoreRecord] = []

    if not coarse_enabled:
        fine_windows = build_sliding_windows(
            timeline_start_sec,
            duration,
            window_size=FINE_WINDOW_SEC,
            stride=fine_stride,
        )
        meta.note_parts.append(f"短视频精扫：{len(fine_windows)} 窗")
    else:
        coarse_tiles = build_coarse_tiles(
            timeline_start_sec,
            duration,
            tile_size=coarse_tile_size,
            stride=coarse_tile_stride,
        )
        meta.coarse_windows = len(coarse_tiles)
        meta.note_parts.append(
            f"宫格粗筛 {len(coarse_tiles)} 格（{coarse_tile_size:.0f}s/{coarse_tile_stride:.0f}s×"
            f"{COARSE_TILE_FRAMES}帧，Top-{int(COARSE_TOP_K_RATIO * 100)}%≤{COARSE_MAX_TILES}，并行×{COARSE_PARALLEL_WORKERS}）"
        )

    meta.fine_windows = len(fine_windows)
    total_work = len(fine_windows) if fine_windows else len(coarse_tiles)

    yield {
        "type": "started",
        "engine": meta.engine,
        "search_spec": spec.to_dict(),
        "coarse_enabled": coarse_enabled,
        "coarse_skipped": not coarse_enabled,
        "total_windows": total_work,
        "coarse_windows": len(coarse_tiles),
        "fine_window_count": len(fine_windows),
        "score_threshold": fine_threshold,
        "search_criteria": user_query,
    }

    if coarse_enabled and coarse_tiles:
        tile_fps = _coarse_fps_for_tile(coarse_tile_size, COARSE_TILE_FRAMES)
        workers = min(COARSE_PARALLEL_WORKERS, len(coarse_tiles))

        def run_indexed(index: int, tile_start: float, tile_end: float) -> Tuple[int, ClipScoreRecord]:
            record = _run_coarse_tile(
                llm_manager,
                video_path,
                block,
                spec,
                timeline_start_sec=timeline_start_sec,
                duration=duration,
                tile_start=tile_start,
                tile_end=tile_end,
                tile_fps=tile_fps,
            )
            return index, record

        indexed_tiles = list(enumerate(coarse_tiles))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(run_indexed, index, ts, te): index
                for index, (ts, te) in indexed_tiles
            }
            results: List[Optional[ClipScoreRecord]] = [None] * len(coarse_tiles)
            completed = 0
            for future in as_completed(futures):
                index, record = future.result()
                results[index] = record
                completed += 1
                total_frames += COARSE_TILE_FRAMES

                yield {
                    "type": "progress",
                    "scan_phase": "coarse",
                    "window_index": completed,
                    "total_windows": len(coarse_tiles),
                    "start_sec": round(record.start_sec, 2),
                    "end_sec": round(record.end_sec, 2),
                }
                yield {
                    "type": "clip_score",
                    "scan_phase": "coarse",
                    "window_index": completed,
                    "total_windows": len(coarse_tiles),
                    **score_record_to_dict(record),
                }

        coarse_records = [record for record in results if record is not None]

        coarse_candidates = select_coarse_candidates(
            coarse_records,
            score_threshold=coarse_threshold,
            top_k_ratio=COARSE_TOP_K_RATIO,
            max_tiles=COARSE_MAX_TILES,
        )
        coarse_hits = coarse_candidates

        hotspots = coarse_candidates_to_hotspots(
            coarse_hits,
            timeline_start_sec,
            timeline_end,
        )

        yield {
            "type": "coarse_complete",
            "total_windows": len(coarse_tiles),
            "hits": [
                {**score_record_to_dict(r), "is_event": True} for r in coarse_hits
            ],
            "all_scored": [score_record_to_dict(r) for r in coarse_records],
            "hotspots": [region_to_dict(s, e) for s, e in hotspots],
            "hit_count": len(coarse_hits),
        }

        if not hotspots:
            meta.note_parts.append("宫格粗筛无热点")
            yield {"type": "matches", "matches": [], "scan_phase": "fine"}
            yield {
                "type": "done",
                "block_id": str(block.get("id") or ""),
                "search_criteria": user_query,
                "transcript_source": "none",
                "transcript_segment_count": 0,
                "visual_frame_count": total_frames,
                "matches": [],
                "note": "；".join(meta.note_parts) + "；未找到符合检索条件的事件",
                "engine": meta.engine,
                "search_spec": spec.to_dict(),
                "coarse_hits": [],
                "hotspots": [],
            }
            return

        fine_windows = build_fine_windows_in_hotspots(
            hotspots,
            window_size=FINE_WINDOW_SEC,
            stride=fine_stride,
        )
        if len(fine_windows) > MAX_FINE_WINDOWS_CAP:
            fine_windows = fine_windows[:MAX_FINE_WINDOWS_CAP]
            meta.note_parts.append(f"精扫窗过多，已截断至 {MAX_FINE_WINDOWS_CAP} 窗")
        meta.fine_windows = len(fine_windows)
        meta.note_parts.append(
            f"精扫仅热点区：{len(hotspots)} 段 → {len(fine_windows)} 窗"
        )

        yield {
            "type": "fine_phase_started",
            "hotspots": [region_to_dict(s, e) for s, e in hotspots],
            "fine_windows": [region_to_dict(s, e) for s, e in fine_windows],
            "total_windows": len(fine_windows),
            "coarse_hit_count": len(coarse_hits),
        }

    if not fine_windows:
        yield {
            "type": "done",
            "block_id": str(block.get("id") or ""),
            "search_criteria": user_query,
            "transcript_source": "none",
            "transcript_segment_count": 0,
            "visual_frame_count": total_frames,
            "matches": [],
            "note": "；".join(meta.note_parts) + "；无可分析窗口",
            "engine": meta.engine,
            "search_spec": spec.to_dict(),
        }
        return

    use_audio = include_audio and FINE_INCLUDE_AUDIO
    for index, (win_start, win_end) in enumerate(fine_windows):
        clip_duration = max(0.1, win_end - win_start)
        source_start = timeline_sample_to_source_sec(
            block, timeline_start_sec, duration, win_start
        )

        yield {
            "type": "progress",
            "scan_phase": "fine",
            "window_index": index + 1,
            "total_windows": len(fine_windows),
            "start_sec": round(win_start, 2),
            "end_sec": round(win_end, 2),
        }

        frames = _extract_clip_frames(
            video_path,
            source_start,
            clip_duration,
            fps=FINE_FPS,
            max_frames=FINE_FRAMES,
        )
        total_frames += len(frames)
        audio_b64 = (
            _extract_clip_audio_wav_b64(video_path, source_start, clip_duration)
            if use_audio
            else None
        )

        if not frames:
            yield {
                "type": "clip_score",
                "scan_phase": "fine",
                "start_sec": round(win_start, 2),
                "end_sec": round(win_end, 2),
                "score": 0.0,
                "is_event": False,
                "skipped": True,
            }
            continue

        record = classify_clip(
            llm_manager,
            spec,
            frames,
            audio_wav_b64=audio_b64,
            clip_meta={"start_sec": win_start, "end_sec": win_end},
        )
        fine_records.append(record)

        yield {
            "type": "clip_score",
            "scan_phase": "fine",
            "window_index": index + 1,
            "total_windows": len(fine_windows),
            "start_sec": round(record.start_sec, 2),
            "end_sec": round(record.end_sec, 2),
            "score": round(record.score, 3),
            "is_event": record.is_event,
            "summary": record.summary,
        }

        matches = _records_to_moments(
            block,
            timeline_start_sec,
            duration,
            fine_records,
            score_threshold=fine_threshold,
            max_results=max_results,
        )
        yield {
            "type": "matches",
            "matches": [moment_to_dict(m) for m in matches],
            "windows_processed": index + 1,
            "total_windows": len(fine_windows),
            "scan_phase": "fine",
        }

    matches = _records_to_moments(
        block,
        timeline_start_sec,
        duration,
        fine_records,
        score_threshold=fine_threshold,
        max_results=max_results,
    )
    note = "；".join(meta.note_parts)
    if matches:
        note += "；matches 含 timeline/trim 时间，可 export_moment_clips_to_pool"
    else:
        note += "；未找到符合检索条件的事件"

    yield {
        "type": "done",
        "block_id": str(block.get("id") or ""),
        "search_criteria": user_query,
        "transcript_source": "none",
        "transcript_segment_count": 0,
        "visual_frame_count": total_frames,
        "matches": [moment_to_dict(m) for m in matches],
        "note": note,
        "engine": meta.engine,
        "windows_processed": len(fine_windows),
        "total_windows": len(fine_windows),
        "coarse_windows": meta.coarse_windows,
        "fine_windows": len(fine_windows),
        "search_spec": spec.to_dict(),
    }


def moment_to_dict(moment: MatchedMoment) -> Dict[str, Any]:
    return {
        "start_sec": moment.start_sec,
        "end_sec": moment.end_sec,
        "timeline_start_sec": moment.timeline_start_sec,
        "timeline_end_sec": moment.timeline_end_sec,
        "trim_in_sec": moment.trim_in_sec,
        "trim_out_sec": moment.trim_out_sec,
        "text_preview": moment.text_preview,
        "match_score": moment.match_score,
        "match_reason": moment.match_reason,
        "transcript_source": moment.transcript_source,
    }


def search_clip_events(
    llm_manager: Any,
    project_dir: Path,
    block: Dict[str, Any],
    search_criteria: str,
    timeline_start_sec: float,
    duration_sec: float,
    max_results: int,
    *,
    recall_mode: str = "balanced",
    include_audio: bool = True,
    search_spec: Optional[ClipSearchSpec] = None,
) -> Tuple[List[MatchedMoment], Dict[str, Any]]:
    final_matches: List[MatchedMoment] = []
    meta: Dict[str, Any] = {}
    for event in iter_clip_event_search(
        llm_manager,
        project_dir,
        block,
        search_criteria,
        timeline_start_sec,
        duration_sec,
        max_results,
        recall_mode=recall_mode,
        include_audio=include_audio,
        search_spec=search_spec,
    ):
        if event.get("type") == "matches":
            raw = event.get("matches") or []
            final_matches = [
                MatchedMoment(
                    start_sec=float(item.get("start_sec") or 0),
                    end_sec=float(item.get("end_sec") or 0),
                    timeline_start_sec=float(item.get("timeline_start_sec") or 0),
                    timeline_end_sec=float(item.get("timeline_end_sec") or 0),
                    trim_in_sec=float(item.get("trim_in_sec") or 0),
                    trim_out_sec=float(item.get("trim_out_sec") or 0),
                    text_preview=str(item.get("text_preview") or ""),
                    match_score=float(item.get("match_score") or 0),
                    match_reason=str(item.get("match_reason") or ""),
                    transcript_source=str(item.get("transcript_source") or "visual_clip"),
                )
                for item in raw
                if isinstance(item, dict)
            ]
        elif event.get("type") == "done":
            meta = event
    return final_matches, meta

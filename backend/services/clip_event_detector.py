"""统一 Pipeline：LLM Planner → 粗扫 → 精扫 → 时间段合并。"""
from __future__ import annotations

import base64
import json
import logging
import subprocess
import tempfile
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

FINE_WINDOW_SEC = 16.0
FINE_STRIDE_SEC = 4.0
FINE_STRIDE_HIGH_RECALL_SEC = 2.0
FINE_FPS = 3.0
FINE_FRAMES = 48
FINE_INCLUDE_AUDIO = True

COARSE_WINDOW_SEC = 60.0
COARSE_STRIDE_SEC = 30.0
COARSE_STRIDE_HIGH_RECALL_SEC = 15.0
COARSE_FRAMES = 12
COARSE_THRESHOLD_BALANCED = 0.45
COARSE_THRESHOLD_HIGH = 0.38
HOTSPOT_PAD_SEC = 20.0
HOTSPOT_MERGE_GAP_SEC = 30.0
SKIP_COARSE_DURATION_SEC = 180.0

FRAME_MAX_WIDTH = 480
SCORE_THRESHOLD_BALANCED = 0.7
SCORE_THRESHOLD_HIGH = 0.6
MERGE_GAP_SEC = 8.0

COARSE_CLASSIFIER_SYSTEM = """You are a video segment scout. You receive sparse frames from ~1 minute of video plus a search_spec that defines the target event.

Decide whether this minute might contain the target (be inclusive at coarse stage).

Return JSON only:
{
  "summary": "one sentence about what happens",
  "possible_match": true/false,
  "confidence": 0-1
}

Use search_description, positive_examples, negative_examples. possible_match=true when the target might occur; false only when clearly unrelated or matches negative_examples."""

CLIP_CLASSIFIER_SYSTEM = """You are a video clip classifier. You receive sequential frames and optional audio plus search_spec defining the target event.

Return JSON only:
{
  "is_event": true/false,
  "score": 0-1,
  "confidence": 0-1,
  "summary": "short description"
}

Use search_description as the primary definition. positive_examples guide what counts; negative_examples must be rejected. Require clear visual or audible evidence; do not infer unstated dialogue."""


@dataclass
class ClipScoreRecord:
    start_sec: float
    end_sec: float
    score: float
    is_event: bool
    summary: str = ""


@dataclass
class ClipEventSearchMeta:
    engine: str = "clip_planner_coarse_fine_v1"
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


def coarse_hits_to_hotspots(
    records: List[ClipScoreRecord],
    timeline_start_sec: float,
    timeline_end_sec: float,
    *,
    score_threshold: float,
    merge_gap_sec: float = HOTSPOT_MERGE_GAP_SEC,
    pad_sec: float = HOTSPOT_PAD_SEC,
) -> List[Tuple[float, float]]:
    positives = [
        row for row in records if row.is_event and float(row.score) >= score_threshold
    ]
    if not positives:
        return []

    ordered = sorted(positives, key=lambda item: item.start_sec)
    merged: List[Tuple[float, float]] = []
    cur_start = ordered[0].start_sec
    cur_end = ordered[0].end_sec

    for row in ordered[1:]:
        if row.start_sec - cur_end <= merge_gap_sec:
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
    return deduped


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
    coarse: bool = False,
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

    user_payload = {
        "search_spec": search_spec.classifier_payload(),
        "clip_start_sec": round(start_sec, 2),
        "clip_end_sec": round(end_sec, 2),
        "frame_count": len(frame_b64_list),
        "has_audio": bool(audio_wav_b64),
        "scan_mode": "coarse" if coarse else "fine",
    }
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Does this clip contain the target event?\n\n"
                f"Payload JSON:\n{json.dumps(user_payload, ensure_ascii=False)}\n\n"
                f"Return JSON only."
            ),
            "images": images,
        },
    ]
    try:
        response = llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=384 if coarse else 512,
            num_ctx=32768 if coarse else 65536,
            timeout=180 if coarse else 300,
            temperature=0.15,
        )
        parsed = llm_manager.parse_json_response(response.content or "")
    except Exception as exc:
        logger.warning("clip 分类失败 %.1f-%.1fs: %s", start_sec, end_sec, exc)
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    if not isinstance(parsed, dict):
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    if coarse:
        score = float(parsed.get("confidence") or parsed.get("score") or 0)
        is_event = bool(parsed.get("possible_match", parsed.get("is_event")))
        if not is_event and score >= 0.65:
            is_event = True
    else:
        score = float(parsed.get("score") or 0)
        is_event = bool(parsed.get("is_event"))
        if not is_event and score >= 0.75:
            is_event = True
        if is_event and score < 0.35:
            is_event = False

    summary = str(parsed.get("summary") or "").strip()
    return ClipScoreRecord(start_sec, end_sec, score, is_event, summary)


def classify_clip_coarse(
    llm_manager: Any,
    search_spec: ClipSearchSpec,
    frame_b64_list: List[str],
    *,
    clip_meta: Optional[Dict[str, Any]] = None,
) -> ClipScoreRecord:
    return _classify_clip_internal(
        llm_manager,
        search_spec,
        frame_b64_list,
        system_prompt=COARSE_CLASSIFIER_SYSTEM,
        clip_meta=clip_meta,
        coarse=True,
    )


def classify_clip(
    llm_manager: Any,
    search_spec: ClipSearchSpec,
    frame_b64_list: List[str],
    *,
    audio_wav_b64: Optional[str] = None,
    clip_meta: Optional[Dict[str, Any]] = None,
) -> ClipScoreRecord:
    return _classify_clip_internal(
        llm_manager,
        search_spec,
        frame_b64_list,
        system_prompt=CLIP_CLASSIFIER_SYSTEM,
        audio_wav_b64=audio_wav_b64,
        clip_meta=clip_meta,
        coarse=False,
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


def _coarse_fps_for_window(window_sec: float, frame_count: int) -> float:
    return max(0.1, frame_count / max(1.0, window_sec))


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
    coarse_stride = COARSE_STRIDE_HIGH_RECALL_SEC if high_recall else COARSE_STRIDE_SEC
    coarse_threshold = COARSE_THRESHOLD_HIGH if high_recall else COARSE_THRESHOLD_BALANCED
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
    coarse_windows: List[Tuple[float, float]] = []
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
        coarse_windows = build_sliding_windows(
            timeline_start_sec,
            duration,
            window_size=COARSE_WINDOW_SEC,
            stride=coarse_stride,
        )
        meta.coarse_windows = len(coarse_windows)
        meta.note_parts.append(
            f"粗扫 {len(coarse_windows)} 窗（60s/{coarse_stride}s×{COARSE_FRAMES}帧）"
        )

    meta.fine_windows = len(fine_windows)
    total_work = len(fine_windows) if fine_windows else len(coarse_windows)

    yield {
        "type": "started",
        "engine": meta.engine,
        "search_spec": spec.to_dict(),
        "coarse_enabled": coarse_enabled,
        "total_windows": total_work,
        "coarse_windows": len(coarse_windows),
        "fine_windows": len(fine_windows),
        "score_threshold": fine_threshold,
        "search_criteria": user_query,
    }

    if coarse_enabled and coarse_windows:
        coarse_fps = _coarse_fps_for_window(COARSE_WINDOW_SEC, COARSE_FRAMES)
        for index, (win_start, win_end) in enumerate(coarse_windows):
            clip_duration = max(0.1, win_end - win_start)
            source_start = timeline_sample_to_source_sec(
                block, timeline_start_sec, duration, win_start
            )

            yield {
                "type": "progress",
                "scan_phase": "coarse",
                "window_index": index + 1,
                "total_windows": len(coarse_windows),
                "start_sec": round(win_start, 2),
                "end_sec": round(win_end, 2),
            }

            frames = _extract_clip_frames(
                video_path,
                source_start,
                clip_duration,
                fps=coarse_fps,
                max_frames=COARSE_FRAMES,
            )
            total_frames += len(frames)
            if not frames:
                continue

            record = classify_clip_coarse(
                llm_manager,
                spec,
                frames,
                clip_meta={"start_sec": win_start, "end_sec": win_end},
            )
            coarse_records.append(record)

            yield {
                "type": "clip_score",
                "scan_phase": "coarse",
                "window_index": index + 1,
                "total_windows": len(coarse_windows),
                "start_sec": round(record.start_sec, 2),
                "end_sec": round(record.end_sec, 2),
                "score": round(record.score, 3),
                "is_event": record.is_event,
                "summary": record.summary,
            }

        hotspots = coarse_hits_to_hotspots(
            coarse_records,
            timeline_start_sec,
            timeline_end,
            score_threshold=coarse_threshold,
        )
        yield {
            "type": "hotspots",
            "count": len(hotspots),
            "regions": [
                {"start_sec": round(s, 2), "end_sec": round(e, 2)} for s, e in hotspots
            ],
        }

        if not hotspots:
            meta.note_parts.append("粗扫无热点")
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
            }
            return

        fine_windows = build_fine_windows_in_hotspots(
            hotspots,
            window_size=FINE_WINDOW_SEC,
            stride=fine_stride,
        )
        meta.fine_windows = len(fine_windows)
        meta.note_parts.append(f"精扫：{len(hotspots)} 热点 → {len(fine_windows)} 窗")

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

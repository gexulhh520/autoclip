"""滑窗 + 多模态 clip 分类 + 时间合并：视频事件检测（非整段理解、非全文检索）。"""
from __future__ import annotations

import base64
import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Generator, Iterator, List, Optional, Tuple

from backend.services.editor_moment_search import (
    MatchedMoment,
    build_matched_moments_from_timeline_ranges,
    merge_matched_moments,
    normalize_visual_search_criteria,
    timeline_sample_to_source_sec,
)
from backend.services.moment_signal_prefilter import resolve_block_video_path
from backend.utils.ffmpeg_utils import get_ffmpeg_path

logger = logging.getLogger(__name__)

WINDOW_SIZE_SEC = 16.0
STRIDE_SEC = 4.0
CLIP_FPS = 3.0
FRAMES_PER_CLIP = 48
FRAME_MAX_WIDTH = 480
SCORE_THRESHOLD_BALANCED = 0.7
SCORE_THRESHOLD_HIGH = 0.6
MERGE_GAP_SEC = 8.0
STRIDE_HIGH_RECALL_SEC = 2.0

CLIP_CLASSIFIER_SYSTEM = """You are a video clip classifier.

Task: determine whether the clip contains the target event.
You may receive sequential video frames and optional clip audio.

Return JSON only (no markdown):

{
  "is_event": true/false,
  "score": 0-1,
  "confidence": 0-1,
  "summary": "short description"
}

Rules:
- score reflects how strongly the clip matches the target event
- is_event=true only when clear visual or audio evidence exists
- do not infer dialogue content without visible subtitles or audible speech matching the event
- action events need visible motion/conflict/explosion/etc., not static similar scenes"""


@dataclass
class ClipScoreRecord:
    start_sec: float
    end_sec: float
    score: float
    is_event: bool
    summary: str = ""


@dataclass
class ClipEventSearchMeta:
    engine: str = "clip_sliding_v1"
    total_windows: int = 0
    windows_processed: int = 0
    frames_per_clip: int = FRAMES_PER_CLIP
    include_audio: bool = True
    score_threshold: float = SCORE_THRESHOLD_BALANCED
    note_parts: List[str] = field(default_factory=list)


def build_sliding_windows(
    timeline_start_sec: float,
    duration_sec: float,
    *,
    window_size: float = WINDOW_SIZE_SEC,
    stride: float = STRIDE_SEC,
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


def merge_clip_scores(
    records: List[ClipScoreRecord],
    *,
    score_threshold: float = SCORE_THRESHOLD_BALANCED,
    merge_gap_sec: float = MERGE_GAP_SEC,
) -> List[Tuple[float, float, float, str]]:
    """将 clip 级得分合并为 timeline 区间 (start, end, avg_score, summary)。"""
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
    fps: float = CLIP_FPS,
    max_width: int = FRAME_MAX_WIDTH,
    max_frames: int = FRAMES_PER_CLIP,
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
        subprocess.run(cmd, check=True, capture_output=True, timeout=max(120, int(clip_duration_sec * 4) + 30))
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
        subprocess.run(cmd, check=True, capture_output=True, timeout=max(60, int(clip_duration_sec * 2) + 20))
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


def classify_clip(
    llm_manager: Any,
    search_criteria: str,
    frame_b64_list: List[str],
    *,
    audio_wav_b64: Optional[str] = None,
    clip_meta: Optional[Dict[str, Any]] = None,
) -> ClipScoreRecord:
    meta = clip_meta or {}
    start_sec = float(meta.get("start_sec") or 0)
    end_sec = float(meta.get("end_sec") or start_sec)
    criteria = (search_criteria or "").strip()
    if not criteria or not frame_b64_list:
        return ClipScoreRecord(start_sec, end_sec, 0.0, False, "")

    images: List[str] = []
    if audio_wav_b64:
        images.append(audio_wav_b64)
    images.extend(frame_b64_list)

    user_payload = {
        "target_event": criteria,
        "clip_start_sec": round(start_sec, 2),
        "clip_end_sec": round(end_sec, 2),
        "frame_count": len(frame_b64_list),
        "has_audio": bool(audio_wav_b64),
    }
    messages = [
        {"role": "system", "content": CLIP_CLASSIFIER_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Classify this clip.\n\n"
                f"Meta JSON:\n{json.dumps(user_payload, ensure_ascii=False)}\n\n"
                f"Return JSON only."
            ),
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
        logger.warning("clip 分类失败 %.1f-%.1fs: %s", start_sec, end_sec, exc)
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
) -> Iterator[Dict[str, Any]]:
    """逐窗分析并 yield NDJSON 事件（progress / clip_score / matches / done）。"""
    criteria = normalize_visual_search_criteria(search_criteria)
    duration = max(0.1, float(duration_sec))
    high_recall = str(recall_mode or "balanced") == "high"
    stride = STRIDE_HIGH_RECALL_SEC if high_recall else STRIDE_SEC
    score_threshold = SCORE_THRESHOLD_HIGH if high_recall else SCORE_THRESHOLD_BALANCED

    video_path = resolve_block_video_path(project_dir, block)
    if video_path is None:
        yield {
            "type": "error",
            "message": "无法定位片段视频文件",
        }
        yield {
            "type": "done",
            "block_id": str(block.get("id") or ""),
            "search_criteria": search_criteria,
            "transcript_source": "none",
            "transcript_segment_count": 0,
            "visual_frame_count": 0,
            "matches": [],
            "note": "无法定位片段视频文件",
        }
        return

    windows = build_sliding_windows(
        timeline_start_sec,
        duration,
        window_size=WINDOW_SIZE_SEC,
        stride=stride,
    )
    meta = ClipEventSearchMeta(
        total_windows=len(windows),
        score_threshold=score_threshold,
        include_audio=include_audio,
    )
    meta.note_parts.append(
        f"滑窗 clip 分类：{len(windows)} 窗 × {FRAMES_PER_CLIP} 帧"
        f"{' + 音频' if include_audio else ''}，threshold={score_threshold}"
    )

    yield {
        "type": "started",
        "engine": meta.engine,
        "total_windows": len(windows),
        "window_size_sec": WINDOW_SIZE_SEC,
        "stride_sec": stride,
        "frames_per_clip": FRAMES_PER_CLIP,
        "include_audio": include_audio,
        "score_threshold": score_threshold,
        "search_criteria": criteria,
    }

    records: List[ClipScoreRecord] = []
    total_frames = 0

    for index, (win_start, win_end) in enumerate(windows):
        clip_duration = max(0.1, win_end - win_start)
        source_start = timeline_sample_to_source_sec(
            block,
            timeline_start_sec,
            duration,
            win_start,
        )

        yield {
            "type": "progress",
            "window_index": index + 1,
            "total_windows": len(windows),
            "start_sec": round(win_start, 2),
            "end_sec": round(win_end, 2),
        }

        frames = _extract_clip_frames(
            video_path,
            source_start,
            clip_duration,
            fps=CLIP_FPS,
            max_frames=FRAMES_PER_CLIP,
        )
        total_frames += len(frames)
        audio_b64 = (
            _extract_clip_audio_wav_b64(video_path, source_start, clip_duration)
            if include_audio
            else None
        )

        if not frames:
            yield {
                "type": "clip_score",
                "start_sec": round(win_start, 2),
                "end_sec": round(win_end, 2),
                "score": 0.0,
                "is_event": False,
                "summary": "",
                "skipped": True,
            }
            continue

        record = classify_clip(
            llm_manager,
            criteria,
            frames,
            audio_wav_b64=audio_b64,
            clip_meta={"start_sec": win_start, "end_sec": win_end},
        )
        records.append(record)
        meta.windows_processed = index + 1

        yield {
            "type": "clip_score",
            "window_index": index + 1,
            "total_windows": len(windows),
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
            records,
            score_threshold=score_threshold,
            max_results=max_results,
        )
        yield {
            "type": "matches",
            "matches": [moment_to_dict(m) for m in matches],
            "windows_processed": index + 1,
            "total_windows": len(windows),
        }

    matches = _records_to_moments(
        block,
        timeline_start_sec,
        duration,
        records,
        score_threshold=score_threshold,
        max_results=max_results,
    )
    note = "；".join(meta.note_parts)
    if matches:
        note += "；matches 含 timeline/trim 时间，可 export_moment_clips_to_pool"
    else:
        note += "；未找到符合检索条件的事件，可放宽描述或开启高召回"

    yield {
        "type": "done",
        "block_id": str(block.get("id") or ""),
        "search_criteria": search_criteria,
        "transcript_source": "none",
        "transcript_segment_count": 0,
        "visual_frame_count": total_frames,
        "matches": [moment_to_dict(m) for m in matches],
        "note": note,
        "engine": meta.engine,
        "windows_processed": len(windows),
        "total_windows": len(windows),
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
) -> Tuple[List[MatchedMoment], Dict[str, Any]]:
    """非流式：跑完所有窗后返回最终 matches 与 meta。"""
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

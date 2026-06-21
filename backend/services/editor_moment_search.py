"""按用户条件在视频片段转写文本中检索匹配时刻。"""
from __future__ import annotations

import base64
import json
import logging
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.core.path_utils import get_project_directory
from backend.utils.ffmpeg_utils import get_ffmpeg_path

logger = logging.getLogger(__name__)

MOMENT_SEARCH_BATCH_SIZE = 24
MAX_MERGED_SEGMENTS = 360
MAX_SEGMENT_TEXT_CHARS = 480
WHISPER_CHUNK_SEC = 45.0
MAX_EXTRACT_FRAME_WIDTH = 480
WHISPER_SKIP_MIN_DURATION_SEC = 180.0

VISUAL_PRIMARY_CRITERIA = re.compile(
    r"打斗|打架|格斗|搏击|交手|枪战|追逐|动作场面|武打|搏斗|对打|械斗|拳脚"
)

VISUAL_TEXT_CRITERIA = re.compile(
    r"诗歌|古诗词|诗词|古诗|律诗|绝句|文言|对联|字幕|画面文字|屏幕.*字|片头字|标题字"
)

COARSE_VISUAL_FRAME_CAP = 12
FINE_FRAMES_PER_RANGE = 4
FINE_VISUAL_FRAME_CAP = 24
TEXT_CONFIRM_FRAMES_PER_MATCH = 2
TEXT_CONFIRM_FRAME_CAP = 16

FIND_MOMENTS_SYSTEM = """你是视频片段检索助手。用户会给出检索条件与带 index 的字幕/转写片段列表。
只输出一个 JSON 对象（不要 markdown、不要解释）：

{"matches":[{"segment_index":0,"match_score":0.85,"match_reason":"15-40字说明为何符合"}]}

规则：
- segment_index 必须是输入列表中的 index 整数
- match_score 为 0–1，从严；勉强符合的应低于 0.6 或不列入
- 只列真正符合检索条件的片段；无符合时 matches 为空数组
- match_reason 简短中文，说明与条件的关联（可引用关键词，勿编造未出现的台词）
- 诗歌/古诗词/文言：含诵读、完整引用、化用、对联、明显诗词韵律或文言句式；嵌入在口语中的诗句也算
- 金句/哲学/共鸣：按语义与情感匹配，不限于出现 exact 关键词"""

VISUAL_FRAME_MATCH_SYSTEM = """你是视频画面检索助手。用户给出检索条件与一帧预览图时间戳。
判断该帧画面是否符合检索条件（如打斗、追逐、特定场景、人物情绪、屏幕/画面上的文字等）。
只输出 JSON：{"match_score":0-1,"matches":true/false,"reason":"15-40字"}

- 打斗/动作：肢体冲突、击打、格斗、明显对抗
- 诗歌/古诗词/字幕文字：画面或硬字幕中出现诗句、文言、竖排古文字、书法字卡等
- 画面氛围/共鸣：靠构图、表情、情境；无明确视觉证据时 matches=false、score<0.5
- 纯口播台词类：画面中无字幕且无法从画面推断内容时，不要臆造台词，matches=false"""


@dataclass
class VisualFrameHit:
    time_sec: float
    match_score: float
    reason: str

@dataclass
class TranscriptSegment:
    start_sec: float
    end_sec: float
    text: str
    source: str = "srt"


@dataclass
class MatchedMoment:
    start_sec: float
    end_sec: float
    timeline_start_sec: float
    timeline_end_sec: float
    trim_in_sec: float
    trim_out_sec: float
    text_preview: str
    match_score: float
    match_reason: str
    transcript_source: str


def resolve_block_source_window(block: Dict[str, Any]) -> Tuple[float, float]:
    media = block.get("media") or {}
    trim = block.get("trim") or {}
    trim_in = float(trim.get("in_sec") or 0)
    trim_out = float(trim.get("out_sec") or 0)
    source_start = media.get("source_start_sec")
    source_end = media.get("source_end_sec")
    if source_start is not None and source_end is not None:
        return float(source_start), float(source_end)
    if trim_out > trim_in:
        return trim_in, trim_out
    duration = float(block.get("duration_sec") or 0)
    return trim_in, trim_in + max(duration, 0.1)


def is_visual_primary_search(search_criteria: str) -> bool:
    return bool(VISUAL_PRIMARY_CRITERIA.search((search_criteria or "").strip()))


def needs_visual_text_confirm(search_criteria: str) -> bool:
    """口播+画面文字类条件：文本命中后再对对应时间段抽帧确认。"""
    text = (search_criteria or "").strip()
    return bool(VISUAL_TEXT_CRITERIA.search(text))


def resolve_search_strategy(search_criteria: str) -> str:
    if is_visual_primary_search(search_criteria):
        return "visual_primary"
    return "text_primary"


def build_uniform_timeline_sample_times(
    timeline_start_sec: float,
    duration_sec: float,
    count: int,
) -> List[float]:
    count = max(1, min(FINE_VISUAL_FRAME_CAP, int(count)))
    duration = max(0.1, duration_sec)
    if count == 1:
        return [timeline_start_sec + duration * 0.5]
    return [
        timeline_start_sec + ((index + 0.5) / count) * duration
        for index in range(count)
    ]


def build_timeline_sample_times_for_moments(
    moments: List[MatchedMoment],
    *,
    frames_per_moment: int = TEXT_CONFIRM_FRAMES_PER_MATCH,
    max_frames: int = TEXT_CONFIRM_FRAME_CAP,
) -> List[float]:
    times: List[float] = []
    for moment in moments:
        span = max(0.1, moment.timeline_end_sec - moment.timeline_start_sec)
        for index in range(max(1, frames_per_moment)):
            ratio = (index + 1) / (frames_per_moment + 1)
            times.append(moment.timeline_start_sec + span * ratio)
        if len(times) >= max_frames:
            break
    return sorted({round(value, 3) for value in times})[:max_frames]


def build_timeline_sample_times_for_ranges(
    ranges: List[Tuple[float, float, float, str]],
    *,
    frames_per_range: int = FINE_FRAMES_PER_RANGE,
    max_frames: int = FINE_VISUAL_FRAME_CAP,
) -> List[float]:
    times: List[float] = []
    for tl_start, tl_end, _score, _reason in ranges:
        span = max(0.2, tl_end - tl_start)
        for index in range(max(1, frames_per_range)):
            ratio = (index + 1) / (frames_per_range + 1)
            times.append(tl_start + span * ratio)
        if len(times) >= max_frames:
            break
    return sorted({round(value, 3) for value in times})[:max_frames]


def visual_search_two_pass(
    llm_manager: Any,
    project_dir: Path,
    block: Dict[str, Any],
    search_criteria: str,
    timeline_start_sec: float,
    duration_sec: float,
    max_results: int,
) -> Tuple[List[MatchedMoment], int]:
    """画面类检索：稀疏均匀粗筛 → 命中区间加密抽帧再确认。"""
    coarse_times = build_uniform_timeline_sample_times(
        timeline_start_sec,
        duration_sec,
        COARSE_VISUAL_FRAME_CAP,
    )
    frame_dicts = extract_block_sample_frames(
        project_dir,
        block,
        coarse_times,
        timeline_start_sec,
        duration_sec,
    )
    total_frames = len(frame_dicts)
    if not frame_dicts:
        return [], 0

    hits = find_moments_in_frames(
        llm_manager,
        search_criteria,
        frame_dicts,
        max_results=max_results,
    )
    if not hits:
        return [], total_frames

    coarse_interval = duration_sec / max(len(coarse_times), 1)
    coarse_ranges = merge_visual_frame_hits(
        hits,
        max(coarse_interval, 1.0),
        max_results,
    )
    fine_times = build_timeline_sample_times_for_ranges(coarse_ranges)
    if not fine_times:
        return build_matched_moments_from_timeline_ranges(
            block,
            timeline_start_sec,
            duration_sec,
            coarse_ranges,
            "visual",
        ), total_frames

    fine_dicts = extract_block_sample_frames(
        project_dir,
        block,
        fine_times,
        timeline_start_sec,
        duration_sec,
    )
    total_frames += len(fine_dicts)
    if not fine_dicts:
        return build_matched_moments_from_timeline_ranges(
            block,
            timeline_start_sec,
            duration_sec,
            coarse_ranges,
            "visual",
        ), total_frames

    fine_hits = find_moments_in_frames(
        llm_manager,
        search_criteria,
        fine_dicts,
        max_results=max_results,
    )
    if not fine_hits:
        return build_matched_moments_from_timeline_ranges(
            block,
            timeline_start_sec,
            duration_sec,
            coarse_ranges,
            "visual",
        ), total_frames

    fine_interval = max(2.0, duration_sec / max(len(fine_times), 1) * 0.5)
    fine_ranges = merge_visual_frame_hits(
        fine_hits,
        fine_interval,
        max_results,
    )
    return build_matched_moments_from_timeline_ranges(
        block,
        timeline_start_sec,
        duration_sec,
        fine_ranges,
        "visual",
    ), total_frames


def boost_text_moments_with_visual_hits(
    text_moments: List[MatchedMoment],
    visual_hits: List[VisualFrameHit],
) -> List[MatchedMoment]:
    if not text_moments or not visual_hits:
        return text_moments
    boosted: List[MatchedMoment] = []
    for moment in text_moments:
        best_score = 0.0
        for hit in visual_hits:
            if hit.time_sec < moment.timeline_start_sec - 0.5:
                continue
            if hit.time_sec > moment.timeline_end_sec + 0.5:
                continue
            best_score = max(best_score, hit.match_score)
        if best_score > 0:
            moment = MatchedMoment(
                start_sec=moment.start_sec,
                end_sec=moment.end_sec,
                timeline_start_sec=moment.timeline_start_sec,
                timeline_end_sec=moment.timeline_end_sec,
                trim_in_sec=moment.trim_in_sec,
                trim_out_sec=moment.trim_out_sec,
                text_preview=moment.text_preview,
                match_score=round(min(1.0, moment.match_score + best_score * 0.08), 3),
                match_reason=moment.match_reason,
                transcript_source=f"{moment.transcript_source}+visual",
            )
        boosted.append(moment)
    return boosted


@dataclass
class StagedMomentSearchResult:
    matches: List[MatchedMoment]
    transcript_source: str
    transcript_segment_count: int
    visual_frame_count: int
    note_parts: List[str]


def search_block_moments_staged(
    llm_manager: Any,
    project_id: str,
    session_id: str,
    block: Dict[str, Any],
    search_criteria: str,
    timeline_start_sec: float,
    duration_sec: float,
    max_results: int,
    *,
    client_sample_times_sec: Optional[List[float]] = None,
    client_frames: Optional[List[Dict[str, Any]]] = None,
) -> StagedMomentSearchResult:
    """分段检索：文本优先走转写；画面类走粗筛+候选区加密抽帧；诗/字幕类文本后再画面确认。"""
    criteria = (search_criteria or "").strip()
    strategy = resolve_search_strategy(criteria)
    duration = max(0.1, duration_sec)
    note_parts: List[str] = [f"策略：{strategy}"]

    client_frames = client_frames or []
    if client_frames:
        note_parts.append("使用客户端上传帧（兼容模式）")
        segments, transcript_source = collect_block_transcript(
            project_id,
            session_id,
            block,
            skip_whisper=False,
        )
        all_matches: List[MatchedMoment] = []
        if segments:
            scored = find_moments_in_transcript(
                llm_manager, criteria, segments, max_results=max_results
            )
            all_matches.extend(
                build_matched_moments(
                    block, timeline_start_sec, duration, transcript_source, scored
                )
            )
        visual_hits = find_moments_in_frames(
            llm_manager, criteria, client_frames, max_results=max_results
        )
        if visual_hits:
            sample_interval = duration / max(len(client_frames), 1)
            ranges = merge_visual_frame_hits(
                visual_hits, max(sample_interval, 1.0), max_results
            )
            all_matches.extend(
                build_matched_moments_from_timeline_ranges(
                    block, timeline_start_sec, duration, ranges, "visual"
                )
            )
        matches = merge_matched_moments(all_matches, max_results)
        if segments:
            note_parts.append(f"文本检索：{transcript_source}，{len(segments)} 段")
        note_parts.append(f"画面检索：{len(client_frames)} 帧")
        return StagedMomentSearchResult(
            matches=matches,
            transcript_source=transcript_source if segments else "none",
            transcript_segment_count=len(segments),
            visual_frame_count=len(client_frames),
            note_parts=note_parts,
        )

    has_visual_plan = strategy == "visual_primary" or bool(client_sample_times_sec)
    skip_whisper = (
        strategy == "visual_primary"
        and duration >= WHISPER_SKIP_MIN_DURATION_SEC
        and has_visual_plan
    )
    segments, transcript_source = collect_block_transcript(
        project_id,
        session_id,
        block,
        skip_whisper=skip_whisper,
    )
    all_matches: List[MatchedMoment] = []
    visual_frame_count = 0

    if segments:
        scored = find_moments_in_transcript(
            llm_manager, criteria, segments, max_results=max_results
        )
        text_moments = build_matched_moments(
            block, timeline_start_sec, duration, transcript_source, scored
        )
        note_parts.append(f"文本检索：{transcript_source}，{len(segments)} 段")

        if text_moments and needs_visual_text_confirm(criteria):
            confirm_times = build_timeline_sample_times_for_moments(text_moments)
            project_dir = get_project_directory(project_id)
            confirm_frames = extract_block_sample_frames(
                project_dir,
                block,
                confirm_times,
                timeline_start_sec,
                duration,
            )
            visual_frame_count += len(confirm_frames)
            if confirm_frames:
                visual_hits = find_moments_in_frames(
                    llm_manager, criteria, confirm_frames, max_results=max_results
                )
                text_moments = boost_text_moments_with_visual_hits(
                    text_moments, visual_hits
                )
                note_parts.append(
                    f"文本命中画面确认：{len(confirm_frames)} 帧（{len(visual_hits)} 处画面符合）"
                )
        all_matches.extend(text_moments)

    if strategy == "visual_primary":
        project_dir = get_project_directory(project_id)
        visual_moments, frame_count = visual_search_two_pass(
            llm_manager,
            project_dir,
            block,
            criteria,
            timeline_start_sec,
            duration,
            max_results,
        )
        visual_frame_count += frame_count
        all_matches.extend(visual_moments)
        note_parts.append(f"画面两阶段检索：{frame_count} 帧")
    elif not segments and client_sample_times_sec:
        project_dir = get_project_directory(project_id)
        frame_dicts = extract_block_sample_frames(
            project_dir,
            block,
            list(client_sample_times_sec),
            timeline_start_sec,
            duration,
        )
        visual_frame_count += len(frame_dicts)
        if frame_dicts:
            visual_hits = find_moments_in_frames(
                llm_manager, criteria, frame_dicts, max_results=max_results
            )
            if visual_hits:
                sample_interval = duration / max(len(frame_dicts), 1)
                ranges = merge_visual_frame_hits(
                    visual_hits, max(sample_interval, 1.0), max_results
                )
                all_matches.extend(
                    build_matched_moments_from_timeline_ranges(
                        block, timeline_start_sec, duration, ranges, "visual"
                    )
                )
            note_parts.append(f"无转写，均匀画面检索：{len(frame_dicts)} 帧")

    matches = merge_matched_moments(all_matches, max_results)
    if not segments and visual_frame_count == 0:
        note_parts.append(
            "无转写且无预览帧。请确认片段已加载，或先跑导入流水线/安装 Whisper"
        )
    elif matches:
        note_parts.append(
            "matches 含 trim_in_sec/trim_out_sec 与 timeline 时间；裁切可用 update_block_trim"
        )
    else:
        note_parts.append("未找到符合检索条件的片段，可放宽描述或换条件")

    return StagedMomentSearchResult(
        matches=matches,
        transcript_source=transcript_source if segments else "none",
        transcript_segment_count=len(segments),
        visual_frame_count=visual_frame_count,
        note_parts=note_parts,
    )


def timeline_sample_to_source_sec(
    block: Dict[str, Any],
    timeline_start_sec: float,
    timeline_duration_sec: float,
    sample_timeline_sec: float,
) -> float:
    trim = block.get("trim") or {}
    trim_in = float(trim.get("in_sec") or 0)
    trim_out = float(trim.get("out_sec") or trim_in)
    span = max(0.1, trim_out - trim_in)
    offset = float(sample_timeline_sec) - float(timeline_start_sec)
    ratio = max(0.0, min(1.0, offset / max(float(timeline_duration_sec), 0.1)))
    return trim_in + ratio * span


def _extract_single_frame(
    video_path: Path,
    source_sec: float,
    timeline_sec: float,
    max_width: int,
) -> Optional[Dict[str, Any]]:
    ffmpeg = get_ffmpeg_path()
    out_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            out_path = Path(tmp.name)
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            f"{source_sec:.3f}",
            "-i",
            str(video_path),
            "-vframes",
            "1",
            "-vf",
            f"scale='min({max_width},iw)':-2",
            "-q:v",
            "4",
            str(out_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=45)
        if not out_path.exists() or out_path.stat().st_size <= 0:
            return None
        image_b64 = base64.b64encode(out_path.read_bytes()).decode("ascii")
        return {"time_sec": float(timeline_sec), "image_base64": image_b64}
    except Exception as exc:
        logger.warning("ffmpeg 抽帧失败 @%.2fs: %s", source_sec, exc)
        return None
    finally:
        if out_path and out_path.exists():
            try:
                out_path.unlink()
            except OSError:
                pass


def extract_block_sample_frames(
    project_dir: Path,
    block: Dict[str, Any],
    sample_times_sec: List[float],
    timeline_start_sec: float,
    timeline_duration_sec: float,
    max_width: int = MAX_EXTRACT_FRAME_WIDTH,
) -> List[Dict[str, Any]]:
    media = block.get("media") or {}
    rel_path = str(media.get("path") or "").strip()
    if not rel_path or not sample_times_sec:
        return []
    video_path = project_dir / rel_path
    if not video_path.exists():
        return []

    jobs = [
        (
            timeline_sample_to_source_sec(
                block, timeline_start_sec, timeline_duration_sec, float(timeline_sec)
            ),
            float(timeline_sec),
        )
        for timeline_sec in sample_times_sec
    ]
    frames: List[Dict[str, Any]] = []
    max_workers = min(4, len(jobs))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(_extract_single_frame, video_path, source_sec, timeline_sec, max_width)
            for source_sec, timeline_sec in jobs
        ]
        for future in as_completed(futures):
            try:
                frame = future.result()
                if frame:
                    frames.append(frame)
            except Exception as exc:
                logger.warning("批量抽帧任务失败: %s", exc)
    frames.sort(key=lambda item: float(item.get("time_sec") or 0))
    return frames


def source_sec_to_block_trim(block: Dict[str, Any], source_sec: float) -> float:
    media = block.get("media") or {}
    trim = block.get("trim") or {}
    trim_in = float(trim.get("in_sec") or 0)
    trim_out = float(trim.get("out_sec") or trim_in)
    source_start = media.get("source_start_sec")
    if source_start is not None:
        local = trim_in + (source_sec - float(source_start))
    else:
        local = source_sec
    return max(trim_in, min(trim_out, local))


def _load_step2_topics_in_range(
    project_dir: Path, window_start: float, window_end: float
) -> List[TranscriptSegment]:
    timeline_path = project_dir / "metadata" / "step2_timeline.json"
    if not timeline_path.exists():
        return []

    from backend.utils.text_processor import TextProcessor

    tp = TextProcessor()
    try:
        items = json.loads(timeline_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("读取 step2_timeline 失败: %s", exc)
        return []

    if not isinstance(items, list):
        return []

    segments: List[TranscriptSegment] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        start_sec = tp.time_to_seconds(str(item.get("start_time") or "0"))
        end_sec = tp.time_to_seconds(str(item.get("end_time") or "0"))
        if end_sec <= window_start or start_sec >= window_end:
            continue
        outline = str(item.get("outline") or "").strip()
        content = item.get("content")
        content_text = ""
        if isinstance(content, list):
            content_text = " ".join(str(c).strip() for c in content if str(c).strip())
        elif isinstance(content, str):
            content_text = content.strip()
        text = outline
        if content_text and content_text != outline:
            text = f"{outline} {content_text}".strip()
        if not text:
            continue
        segments.append(
            TranscriptSegment(
                start_sec=max(start_sec, window_start),
                end_sec=min(end_sec, window_end),
                text=text[:MAX_SEGMENT_TEXT_CHARS],
                source="timeline_topic",
            )
        )
    return segments


def _load_srt_segments(
    project_id: str, window_start: float, window_end: float
) -> List[TranscriptSegment]:
    from backend.services.pipeline_steps_service import (
        get_timeline_srt_segments,
        seconds_to_srt_timestamp,
    )
    from backend.utils.text_processor import TextProcessor

    result = get_timeline_srt_segments(
        project_id,
        seconds_to_srt_timestamp(window_start),
        seconds_to_srt_timestamp(window_end),
        padding_seconds=0.0,
    )
    tp = TextProcessor()
    segments: List[TranscriptSegment] = []
    for entry in result.get("segments") or []:
        if not isinstance(entry, dict):
            continue
        text = str(entry.get("text") or "").strip()
        if not text:
            continue
        start_sec = tp.time_to_seconds(str(entry.get("start_time") or "0"))
        end_sec = tp.time_to_seconds(str(entry.get("end_time") or "0"))
        segments.append(
            TranscriptSegment(
                start_sec=max(start_sec, window_start),
                end_sec=min(end_sec, window_end),
                text=text[:MAX_SEGMENT_TEXT_CHARS],
                source="srt",
            )
        )
    return segments


def _overlay_fallback_segment(
    block: Dict[str, Any], window_start: float, window_end: float
) -> Optional[TranscriptSegment]:
    overlay = block.get("overlay") or {}
    outline = str(overlay.get("outline") or "").strip()
    content = overlay.get("content")
    content_text = ""
    if isinstance(content, list):
        content_text = " ".join(str(c).strip() for c in content if str(c).strip())
    text = outline
    if content_text:
        text = f"{outline} {content_text}".strip() if outline else content_text
    if not text:
        return None
    return TranscriptSegment(
        start_sec=window_start,
        end_sec=window_end,
        text=text[:MAX_SEGMENT_TEXT_CHARS],
        source="overlay",
    )


def _transcribe_block_whisper(
    project_dir: Path,
    session_id: str,
    block_id: str,
    block: Dict[str, Any],
    window_start: float,
    window_end: float,
) -> List[TranscriptSegment]:
    cache_dir = project_dir / "edit_sessions" / session_id / "transcripts"
    cache_path = cache_dir / f"{block_id}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            raw = cached.get("segments") or []
            return [
                TranscriptSegment(
                    start_sec=float(item.get("start_sec") or 0),
                    end_sec=float(item.get("end_sec") or 0),
                    text=str(item.get("text") or "")[:MAX_SEGMENT_TEXT_CHARS],
                    source=str(item.get("source") or "whisper"),
                )
                for item in raw
                if isinstance(item, dict) and str(item.get("text") or "").strip()
            ]
        except (json.JSONDecodeError, OSError, TypeError, ValueError) as exc:
            logger.warning("读取转写缓存失败: %s", exc)

    media = block.get("media") or {}
    rel_path = str(media.get("path") or "").strip()
    if not rel_path:
        return []
    video_path = project_dir / rel_path
    if not video_path.exists():
        return []

    duration = max(0.1, window_end - window_start)
    wav_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wav_path = Path(tmp.name)
        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            str(max(0.0, window_start)),
            "-t",
            str(duration),
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(wav_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        from backend.utils.speech_recognizer import (
            LanguageCode,
            SpeechRecognitionConfig,
            SpeechRecognitionMethod,
            SpeechRecognizer,
        )

        recognizer = SpeechRecognizer()
        config = SpeechRecognitionConfig(
            method=SpeechRecognitionMethod.WHISPER_LOCAL,
            language=LanguageCode.AUTO,
            model="base",
        )
        from backend.services import whisper_runtime

        if not whisper_runtime.is_installed():
            logger.warning("Whisper 未安装，跳过块内转写")
            return []

        whisper_runtime.ensure_on_path()
        models_dir = str(whisper_runtime.get_models_dir() / "hub")
        language = None
        raw_segments = recognizer._transcribe_with_whisper_fallback(
            config.model,
            models_dir,
            wav_path,
            language,
        )
    except Exception as exc:
        logger.warning("块内 Whisper 转写失败: %s", exc)
        return []
    finally:
        if wav_path and wav_path.exists():
            try:
                wav_path.unlink()
            except OSError:
                pass

    segments: List[TranscriptSegment] = []
    for item in raw_segments:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        rel_start = float(item.get("start") or 0)
        rel_end = float(item.get("end") or rel_start)
        segments.append(
            TranscriptSegment(
                start_sec=window_start + rel_start,
                end_sec=window_start + rel_end,
                text=text[:MAX_SEGMENT_TEXT_CHARS],
                source="whisper",
            )
        )

    if segments:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps({"segments": [asdict(s) for s in segments]}, ensure_ascii=False),
            encoding="utf-8",
        )
    return segments


def merge_transcript_segments(
    segments: List[TranscriptSegment],
    max_chunk_sec: float = WHISPER_CHUNK_SEC,
) -> List[TranscriptSegment]:
    if not segments:
        return []
    ordered = sorted(segments, key=lambda s: s.start_sec)
    merged: List[TranscriptSegment] = []
    bucket_start = ordered[0].start_sec
    bucket_end = ordered[0].end_sec
    texts: List[str] = [ordered[0].text]
    source = ordered[0].source

    for seg in ordered[1:]:
        gap = seg.start_sec - bucket_end
        span = seg.end_sec - bucket_start
        if gap > 1.5 or span > max_chunk_sec or len(" ".join(texts)) > MAX_SEGMENT_TEXT_CHARS:
            merged.append(
                TranscriptSegment(
                    start_sec=bucket_start,
                    end_sec=bucket_end,
                    text=" ".join(texts)[:MAX_SEGMENT_TEXT_CHARS],
                    source=source,
                )
            )
            bucket_start = seg.start_sec
            bucket_end = seg.end_sec
            texts = [seg.text]
            source = seg.source
        else:
            bucket_end = max(bucket_end, seg.end_sec)
            texts.append(seg.text)

    merged.append(
        TranscriptSegment(
            start_sec=bucket_start,
            end_sec=bucket_end,
            text=" ".join(texts)[:MAX_SEGMENT_TEXT_CHARS],
            source=source,
        )
    )
    return merged[:MAX_MERGED_SEGMENTS]


def collect_block_transcript(
    project_id: str,
    session_id: str,
    block: Dict[str, Any],
    *,
    skip_whisper: bool = False,
) -> Tuple[List[TranscriptSegment], str]:
    project_dir = get_project_directory(project_id)
    window_start, window_end = resolve_block_source_window(block)
    segments: List[TranscriptSegment] = []
    transcript_source = "none"

    try:
        srt_segments = _load_srt_segments(project_id, window_start, window_end)
        if srt_segments:
            segments = srt_segments
            transcript_source = "srt"
    except ValueError as exc:
        logger.info("无项目 SRT 字幕: %s", exc)

    if not segments:
        topics = _load_step2_topics_in_range(project_dir, window_start, window_end)
        if topics:
            segments = topics
            transcript_source = "timeline_topic"

    overlay_seg = _overlay_fallback_segment(block, window_start, window_end)
    if overlay_seg and not segments:
        segments = [overlay_seg]
        transcript_source = "overlay"

    duration = window_end - window_start
    needs_whisper = not segments or (
        transcript_source == "overlay" and duration > 120
    )
    if needs_whisper and not skip_whisper:
        whisper_segments = _transcribe_block_whisper(
            project_dir,
            session_id,
            str(block.get("id") or ""),
            block,
            window_start,
            window_end,
        )
        if whisper_segments:
            segments = whisper_segments
            transcript_source = "whisper"

    return merge_transcript_segments(segments), transcript_source


def find_moments_in_transcript(
    llm_manager: Any,
    search_criteria: str,
    segments: List[TranscriptSegment],
    max_results: int = 8,
) -> List[Tuple[TranscriptSegment, float, str]]:
    if not segments:
        return []
    if not (search_criteria or "").strip():
        raise ValueError("检索条件不能为空")

    max_results = max(1, min(24, int(max_results)))
    all_scored: List[Tuple[TranscriptSegment, float, str]] = []

    for batch_start in range(0, len(segments), MOMENT_SEARCH_BATCH_SIZE):
        batch = segments[batch_start : batch_start + MOMENT_SEARCH_BATCH_SIZE]
        payload = [
            {
                "index": idx,
                "start_sec": round(seg.start_sec, 2),
                "end_sec": round(seg.end_sec, 2),
                "text": seg.text,
            }
            for idx, seg in enumerate(batch)
        ]
        user_content = (
            f"检索条件：{search_criteria.strip()}\n"
            f"最多返回 {max_results} 条。\n\n"
            f"片段列表 JSON：\n{json.dumps(payload, ensure_ascii=False)}"
        )
        messages = [
            {"role": "system", "content": FIND_MOMENTS_SYSTEM},
            {"role": "user", "content": user_content},
        ]
        try:
            response = llm_manager.chat_completion(
                messages,
                think=False,
                num_predict=1024,
                timeout=180,
                temperature=0.2,
            )
            parsed = llm_manager.parse_json_response(response.content or "")
        except Exception as exc:
            logger.warning("片段检索 LLM 批次失败: %s", exc)
            continue

        if not isinstance(parsed, dict):
            continue
        matches = parsed.get("matches")
        if not isinstance(matches, list):
            continue
        for item in matches:
            if not isinstance(item, dict):
                continue
            idx = int(item.get("segment_index", -1))
            if idx < 0 or idx >= len(batch):
                continue
            score = float(item.get("match_score") or 0)
            if score < 0.45:
                continue
            reason = str(item.get("match_reason") or "").strip()
            all_scored.append((batch[idx], score, reason))

    all_scored.sort(key=lambda row: row[1], reverse=True)
    return all_scored[:max_results]


def build_matched_moments(
    block: Dict[str, Any],
    timeline_start_sec: float,
    timeline_duration_sec: float,
    transcript_source: str,
    scored: List[Tuple[TranscriptSegment, float, str]],
) -> List[MatchedMoment]:
    trim = block.get("trim") or {}
    trim_in = float(trim.get("in_sec") or 0)
    trim_out = float(trim.get("out_sec") or trim_in)
    block_span = max(0.1, trim_out - trim_in)
    results: List[MatchedMoment] = []

    for seg, score, reason in scored:
        local_start = source_sec_to_block_trim(block, seg.start_sec)
        local_end = source_sec_to_block_trim(block, seg.end_sec)
        if local_end <= local_start + 0.05:
            local_end = min(trim_out, local_start + 3.0)
        timeline_offset_start = (local_start - trim_in) / block_span * timeline_duration_sec
        timeline_offset_end = (local_end - trim_in) / block_span * timeline_duration_sec
        results.append(
            MatchedMoment(
                start_sec=round(local_start, 3),
                end_sec=round(local_end, 3),
                timeline_start_sec=round(timeline_start_sec + timeline_offset_start, 3),
                timeline_end_sec=round(timeline_start_sec + timeline_offset_end, 3),
                trim_in_sec=round(local_start, 3),
                trim_out_sec=round(local_end, 3),
                text_preview=seg.text[:240],
                match_score=round(score, 3),
                match_reason=reason,
                transcript_source=transcript_source,
            )
        )
    return results


def find_moments_in_frames(
    llm_manager: Any,
    search_criteria: str,
    frames: List[Dict[str, Any]],
    max_results: int = 8,
) -> List[VisualFrameHit]:
    if not frames:
        return []
    criteria = (search_criteria or "").strip()
    if not criteria:
        raise ValueError("检索条件不能为空")

    from concurrent.futures import ThreadPoolExecutor, as_completed

    max_workers = min(6, len(frames))
    hits: List[VisualFrameHit] = []

    def score_one(frame: Dict[str, Any]) -> Optional[VisualFrameHit]:
        image_b64 = str(frame.get("image_base64") or "").strip()
        if not image_b64:
            return None
        time_sec = float(frame.get("time_sec") or 0)
        meta = {"time_sec": time_sec, "search_criteria": criteria}
        messages = [
            {"role": "system", "content": VISUAL_FRAME_MATCH_SYSTEM},
            {
                "role": "user",
                "content": f"Frame meta JSON:\n{json.dumps(meta, ensure_ascii=False)}\n\n判断该帧是否符合检索条件。",
                "images": [image_b64],
            },
        ]
        response = llm_manager.chat_completion(
            messages,
            think=False,
            num_predict=256,
            timeout=120,
            temperature=0.15,
        )
        parsed = llm_manager.parse_json_response(response.content or "")
        if not isinstance(parsed, dict):
            return None
        score = float(parsed.get("match_score") or 0)
        matches = parsed.get("matches")
        if matches is False and score < 0.55:
            return None
        if score < 0.5:
            return None
        reason = str(parsed.get("reason") or "").strip()
        return VisualFrameHit(time_sec=time_sec, match_score=score, reason=reason)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(score_one, frame): frame for frame in frames}
        for future in as_completed(futures):
            try:
                hit = future.result()
                if hit:
                    hits.append(hit)
            except Exception as exc:
                logger.warning("画面帧检索失败: %s", exc)

    hits.sort(key=lambda item: item.time_sec)
    return hits


def merge_visual_frame_hits(
    hits: List[VisualFrameHit],
    sample_interval_sec: float,
    max_results: int,
) -> List[Tuple[float, float, float, str]]:
    if not hits:
        return []
    pad = max(2.0, sample_interval_sec * 0.6)
    merged: List[Tuple[float, float, float, str]] = []
    cur_start = hits[0].time_sec
    cur_end = hits[0].time_sec
    cur_score = hits[0].match_score
    reasons = [hits[0].reason]

    for hit in hits[1:]:
        if hit.time_sec - cur_end <= sample_interval_sec * 1.5:
            cur_end = hit.time_sec
            cur_score = max(cur_score, hit.match_score)
            if hit.reason:
                reasons.append(hit.reason)
        else:
            merged.append(
                (
                    max(0.0, cur_start - pad),
                    cur_end + pad,
                    cur_score,
                    reasons[0] if reasons else "",
                )
            )
            cur_start = hit.time_sec
            cur_end = hit.time_sec
            cur_score = hit.match_score
            reasons = [hit.reason]

    merged.append(
        (
            max(0.0, cur_start - pad),
            cur_end + pad,
            cur_score,
            reasons[0] if reasons else "",
        )
    )
    merged.sort(key=lambda row: row[2], reverse=True)
    return merged[:max_results]


def build_matched_moments_from_timeline_ranges(
    block: Dict[str, Any],
    timeline_start_sec: float,
    timeline_duration_sec: float,
    ranges: List[Tuple[float, float, float, str]],
    source_label: str,
) -> List[MatchedMoment]:
    trim = block.get("trim") or {}
    trim_in = float(trim.get("in_sec") or 0)
    trim_out = float(trim.get("out_sec") or trim_in)
    block_span = max(0.1, trim_out - trim_in)
    duration = max(0.1, timeline_duration_sec)
    results: List[MatchedMoment] = []

    for tl_start, tl_end, score, reason in ranges:
        offset_start = max(0.0, tl_start - timeline_start_sec)
        offset_end = min(duration, max(offset_start + 0.1, tl_end - timeline_start_sec))
        local_start = trim_in + (offset_start / duration) * block_span
        local_end = trim_in + (offset_end / duration) * block_span
        results.append(
            MatchedMoment(
                start_sec=round(local_start, 3),
                end_sec=round(local_end, 3),
                timeline_start_sec=round(tl_start, 3),
                timeline_end_sec=round(tl_end, 3),
                trim_in_sec=round(local_start, 3),
                trim_out_sec=round(local_end, 3),
                text_preview=reason[:240],
                match_score=round(score, 3),
                match_reason=reason[:120],
                transcript_source=source_label,
            )
        )
    return results


def merge_matched_moments(
    candidates: List[MatchedMoment],
    max_results: int,
) -> List[MatchedMoment]:
    if not candidates:
        return []
    ordered = sorted(candidates, key=lambda m: m.match_score, reverse=True)
    picked: List[MatchedMoment] = []
    for moment in ordered:
        if len(picked) >= max_results:
            break
        overlaps = False
        for existing in picked:
            overlap_start = max(moment.timeline_start_sec, existing.timeline_start_sec)
            overlap_end = min(moment.timeline_end_sec, existing.timeline_end_sec)
            span = max(0.1, moment.timeline_end_sec - moment.timeline_start_sec)
            if overlap_end > overlap_start and (overlap_end - overlap_start) / span > 0.5:
                overlaps = True
                break
        if not overlaps:
            picked.append(moment)
    return picked

"""按用户条件在视频片段转写文本中检索匹配时刻。"""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.core.path_utils import get_project_directory

logger = logging.getLogger(__name__)

MOMENT_SEARCH_BATCH_SIZE = 24
MAX_MERGED_SEGMENTS = 360
MAX_SEGMENT_TEXT_CHARS = 480
WHISPER_CHUNK_SEC = 45.0

FIND_MOMENTS_SYSTEM = """你是视频片段检索助手。用户会给出检索条件与带 index 的字幕/转写片段列表。
只输出一个 JSON 对象（不要 markdown、不要解释）：

{"matches":[{"segment_index":0,"match_score":0.85,"match_reason":"15-40字说明为何符合"}]}

规则：
- segment_index 必须是输入列表中的 index 整数
- match_score 为 0–1，从严；勉强符合的应低于 0.6 或不列入
- 只列真正符合检索条件的片段；无符合时 matches 为空数组
- match_reason 简短中文，说明与条件的关联（可引用关键词，勿编造未出现的台词）"""


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
    if needs_whisper:
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

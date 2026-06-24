"""Edge TTS synthesis (Microsoft Edge Read Aloud neural voices)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

DEFAULT_ZH_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_EN_VOICE = "en-US-AriaNeural"

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_TICKS_TO_SEC = 1 / 10_000_000
_MAJOR_SPLIT_RE = re.compile(r"(?<=[。！？；.!?;])\s*")
_COMMA_SPLIT_RE = re.compile(r"(?<=[，,、])\s*")
# 竖屏口播字幕单行上限（不含空格）；超出则再按字数切分
MAX_SUBTITLE_DISPLAY_CHARS = 18

# 与 frontend/src/editor/tts/edgeTtsVoices.ts 保持同步
EDGE_TTS_VOICE_ALIASES: dict[str, str] = {
    "zh-CN-XiaohanNeural": "zh-CN-liaoning-XiaobeiNeural",
    "zh-CN-XiaomoNeural": "zh-CN-shaanxi-XiaoniNeural",
    "zh-CN-YunfengNeural": "zh-CN-YunxiaNeural",
}

EDGE_TTS_VOICE_IDS: frozenset[str] = frozenset(
    {
        # 普通话
        "zh-CN-XiaoxiaoNeural",
        "zh-CN-XiaoyiNeural",
        "zh-CN-YunxiNeural",
        "zh-CN-YunxiaNeural",
        "zh-CN-YunyangNeural",
        "zh-CN-YunjianNeural",
        # 方言
        "zh-CN-liaoning-XiaobeiNeural",
        "zh-CN-shaanxi-XiaoniNeural",
        # 粤语
        "zh-HK-HiuGaaiNeural",
        "zh-HK-HiuMaanNeural",
        "zh-HK-WanLungNeural",
        # 台湾国语
        "zh-TW-HsiaoChenNeural",
        "zh-TW-HsiaoYuNeural",
        "zh-TW-YunJheNeural",
    }
)


@dataclass
class SubtitleCueTiming:
    text: str
    start_sec: float
    end_sec: float
    boundary_type: str = "SentenceBoundary"


@dataclass
class SynthesizedSpeech:
    voice: str
    duration_sec: float
    cues: List[SubtitleCueTiming] = field(default_factory=list)
    word_timings: List[SubtitleCueTiming] = field(default_factory=list)


def resolve_edge_tts_voice(voice: Optional[str]) -> str:
    raw = (voice or "").strip()
    if not raw:
        return DEFAULT_ZH_VOICE
    if raw in EDGE_TTS_VOICE_ALIASES:
        return EDGE_TTS_VOICE_ALIASES[raw]
    if raw in EDGE_TTS_VOICE_IDS:
        return raw
    return DEFAULT_ZH_VOICE


def guess_voice(text: str, preferred: Optional[str] = None) -> str:
    if preferred and preferred.strip():
        return resolve_edge_tts_voice(preferred)
    if _CJK_RE.search(text):
        return DEFAULT_ZH_VOICE
    return DEFAULT_EN_VOICE


def normalize_text_for_tts(text: str) -> str:
    """TTS 前将逗号/顿号改为句号，便于 Edge TTS 输出 SentenceBoundary。"""
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    return re.sub(r"[，,、]", "。", cleaned)


def _visible_char_count(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


_DISPLAY_BREAK_CHARS = frozenset("。！？；.!?;，,、：:")


def split_oversized_display_cues(
    cues: List[SubtitleCueTiming],
    *,
    max_chars: int = MAX_SUBTITLE_DISPLAY_CHARS,
) -> List[SubtitleCueTiming]:
    """在句级 TTS 时间轴内，按标点递归切分超长显示字幕。"""
    result: List[SubtitleCueTiming] = []
    for cue in cues:
        result.extend(_split_oversized_display_cue(cue, max_chars=max_chars))
    return result


def _split_oversized_display_cue(
    cue: SubtitleCueTiming,
    *,
    max_chars: int,
) -> List[SubtitleCueTiming]:
    text = cue.text.strip()
    if not text or _visible_char_count(text) <= max_chars:
        return [cue]

    split_at = _find_symbol_bisect_index(text, max_chars)
    if split_at is None:
        parts = _split_by_max_chars(text, max_chars)
        if len(parts) <= 1:
            return [cue]
        return _recurse_split_parts(parts, cue, max_chars=max_chars)

    left = text[:split_at].strip()
    right = text[split_at:].strip()
    if not left or not right:
        parts = _split_by_max_chars(text, max_chars)
        if len(parts) <= 1:
            return [cue]
        return _recurse_split_parts(parts, cue, max_chars=max_chars)

    return _recurse_split_parts([left, right], cue, max_chars=max_chars)


def _recurse_split_parts(
    parts: List[str],
    parent: SubtitleCueTiming,
    *,
    max_chars: int,
) -> List[SubtitleCueTiming]:
    sub_cues = _allocate_clause_timings(parts, parent.start_sec, parent.end_sec)
    expanded: List[SubtitleCueTiming] = []
    for sub in sub_cues:
        expanded.extend(_split_oversized_display_cue(sub, max_chars=max_chars))
    return expanded


def _find_symbol_bisect_index(text: str, max_chars: int) -> Optional[int]:
    """在标点处找尽量均分的切分点；优先使左右两段都不超过 max_chars。"""
    total = _visible_char_count(text)
    if total <= max_chars:
        return None

    candidates: List[tuple[int, int, int]] = []
    visible = 0
    for index, char in enumerate(text):
        if not char.isspace():
            visible += 1
        if char not in _DISPLAY_BREAK_CHARS:
            continue
        left = visible
        right = total - left
        if left <= 0 or right <= 0:
            continue
        candidates.append((index + 1, left, right))

    if not candidates:
        return None

    valid = [item for item in candidates if item[1] <= max_chars and item[2] <= max_chars]
    pool = valid if valid else candidates
    pool.sort(key=lambda item: (abs(item[1] - item[2]), abs(item[1] - total / 2)))
    return pool[0][0]


def _split_by_max_chars(text: str, max_chars: int) -> List[str]:
    """过长无标点片段按字数切分，尽量在弱标点处断开。"""
    text = text.strip()
    if not text or max_chars <= 0:
        return []
    if _visible_char_count(text) <= max_chars:
        return [text]

    weak_breaks = "，,、：:；; "
    chunks: List[str] = []
    remaining = text
    while _visible_char_count(remaining) > max_chars:
        break_at: Optional[int] = None
        visible = 0
        for index, char in enumerate(remaining):
            if not char.isspace():
                visible += 1
            if visible >= max_chars:
                window_start = max(0, index - 8)
                for pos in range(index, window_start - 1, -1):
                    if remaining[pos] in weak_breaks:
                        break_at = pos + 1
                        break
                if break_at is None:
                    break_at = min(index + 1, len(remaining))
                break
        if break_at is None:
            break_at = len(remaining)
        chunk = remaining[:break_at].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[break_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks or [text.strip()]


def _split_clauses(text: str, *, max_chars: int = MAX_SUBTITLE_DISPLAY_CHARS) -> List[str]:
    """句级 → 逗号/顿号 → 字数上限，生成适合屏幕宽度的字幕片段。"""
    text = text.strip()
    if not text:
        return []

    parts: List[str] = []
    for major in _MAJOR_SPLIT_RE.split(text):
        major = major.strip()
        if not major:
            continue
        comma_parts = _COMMA_SPLIT_RE.split(major)
        if len(comma_parts) <= 1:
            comma_parts = [major]
        for segment in comma_parts:
            segment = segment.strip()
            if not segment:
                continue
            if _visible_char_count(segment) > max_chars:
                parts.extend(_split_by_max_chars(segment, max_chars))
            else:
                parts.append(segment)

    return parts or [text]


def _allocate_clause_timings(
    clauses: List[str],
    start_sec: float,
    end_sec: float,
) -> List[SubtitleCueTiming]:
    if not clauses:
        return []
    if len(clauses) == 1:
        return [
            SubtitleCueTiming(
                text=clauses[0],
                start_sec=start_sec,
                end_sec=end_sec,
                boundary_type="ClauseSplit",
            )
        ]

    total_chars = sum(max(1, len(clause)) for clause in clauses)
    span = max(end_sec - start_sec, 0.05)
    cursor = start_sec
    cues: List[SubtitleCueTiming] = []
    for index, clause in enumerate(clauses):
        weight = max(1, len(clause)) / total_chars
        if index == len(clauses) - 1:
            cue_end = end_sec
        else:
            cue_end = cursor + span * weight
        cues.append(
            SubtitleCueTiming(
                text=clause,
                start_sec=cursor,
                end_sec=max(cue_end, cursor + 0.05),
                boundary_type="ClauseSplit",
            )
        )
        cursor = cue_end
    return cues


def refine_subtitle_cues(
    boundaries: List[SubtitleCueTiming],
    narration_text: str,
) -> tuple[List[SubtitleCueTiming], List[SubtitleCueTiming]]:
    """句级 cue 直接使用 TTS 边界，不做逗号/字数估算切分。"""
    if not boundaries:
        text = narration_text.strip()
        if not text:
            return [], []
        duration_guess = max(0.5, len(text) * 0.12)
        sentence_cues = [
            SubtitleCueTiming(
                text=text,
                start_sec=0.0,
                end_sec=duration_guess,
                boundary_type="Estimated",
            )
        ]
        return sentence_cues, _expand_word_timings(sentence_cues)

    sentence_cues = [item for item in boundaries if item.text.strip()]
    word_timings = _expand_word_timings(sentence_cues)
    return sentence_cues, word_timings


def _expand_word_timings(sentence_cues: List[SubtitleCueTiming]) -> List[SubtitleCueTiming]:
    """在无 WordBoundary 时，按字符权重在句内分配词级时间戳。"""
    word_timings: List[SubtitleCueTiming] = []
    for cue in sentence_cues:
        text = cue.text.strip()
        if not text:
            continue
        if _CJK_RE.search(text):
            units = [char for char in text if not char.isspace()]
        else:
            units = [part for part in re.split(r"(\s+)", text) if part and not part.isspace()]
        if len(units) <= 1:
            word_timings.append(
                SubtitleCueTiming(
                    text=text,
                    start_sec=cue.start_sec,
                    end_sec=cue.end_sec,
                    boundary_type="WordEstimate",
                )
            )
            continue
        total = sum(max(1, len(unit)) for unit in units)
        span = max(cue.end_sec - cue.start_sec, 0.05)
        cursor = cue.start_sec
        for index, unit in enumerate(units):
            weight = max(1, len(unit)) / total
            if index == len(units) - 1:
                unit_end = cue.end_sec
            else:
                unit_end = cursor + span * weight
            word_timings.append(
                SubtitleCueTiming(
                    text=unit,
                    start_sec=cursor,
                    end_sec=max(unit_end, cursor + 0.03),
                    boundary_type="WordEstimate",
                )
            )
            cursor = unit_end
    return word_timings


async def synthesize_to_file(
    text: str,
    output_path: Path,
    *,
    voice: Optional[str] = None,
    rate: str = "+0%",
) -> str:
    result = await synthesize_with_timings(
        text,
        output_path,
        voice=voice,
        rate=rate,
    )
    return result.voice


async def synthesize_with_timings(
    text: str,
    output_path: Path,
    *,
    voice: Optional[str] = None,
    rate: str = "+0%",
) -> SynthesizedSpeech:
    try:
        import edge_tts
        from edge_tts.communicate import NoAudioReceived
    except ImportError as exc:
        raise RuntimeError("未安装 edge-tts，请运行: pip install edge-tts") from exc

    cleaned = text.strip()
    if not cleaned:
        raise ValueError("文本为空")

    tts_text = normalize_text_for_tts(cleaned)
    selected_voice = guess_voice(tts_text, voice)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(tts_text, selected_voice, rate=rate)
    boundaries: List[SubtitleCueTiming] = []

    try:
        with output_path.open("wb") as audio_file:
            async for chunk in communicate.stream():
                chunk_type = chunk.get("type")
                if chunk_type == "audio":
                    audio_file.write(chunk["data"])
                elif chunk_type in ("WordBoundary", "SentenceBoundary"):
                    offset = float(chunk.get("offset") or 0) * _TICKS_TO_SEC
                    duration = float(chunk.get("duration") or 0) * _TICKS_TO_SEC
                    boundaries.append(
                        SubtitleCueTiming(
                            text=str(chunk.get("text") or "").strip(),
                            start_sec=offset,
                            end_sec=offset + duration,
                            boundary_type=str(chunk_type),
                        )
                    )
    except NoAudioReceived as exc:
        raise ValueError(
            f"音色 {selected_voice} 当前不可用，请更换其他音色后重试"
        ) from exc

    duration_sec = 0.0
    if boundaries:
        duration_sec = max(item.end_sec for item in boundaries)
    if duration_sec <= 0 and output_path.exists() and output_path.stat().st_size > 0:
        try:
            from backend.utils.video_processor import VideoProcessor

            info = VideoProcessor.get_video_info(output_path)
            duration_sec = float(info.get("duration") or 0) or 0.0
        except Exception:
            duration_sec = 0.0
    if duration_sec <= 0:
        duration_sec = max(0.5, len(tts_text) * 0.12)

    sentence_cues, word_timings = refine_subtitle_cues(boundaries, tts_text)

    return SynthesizedSpeech(
        voice=selected_voice,
        duration_sec=duration_sec,
        cues=sentence_cues,
        word_timings=word_timings,
    )

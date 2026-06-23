"""Edge TTS synthesis (Microsoft Edge Read Aloud neural voices)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

DEFAULT_ZH_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_EN_VOICE = "en-US-AriaNeural"

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")

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


async def synthesize_to_file(
    text: str,
    output_path: Path,
    *,
    voice: Optional[str] = None,
    rate: str = "+0%",
) -> str:
    try:
        import edge_tts
        from edge_tts.communicate import NoAudioReceived
    except ImportError as exc:
        raise RuntimeError("未安装 edge-tts，请运行: pip install edge-tts") from exc

    cleaned = text.strip()
    if not cleaned:
        raise ValueError("文本为空")

    selected_voice = guess_voice(cleaned, voice)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(cleaned, selected_voice, rate=rate)
    try:
        await communicate.save(str(output_path))
    except NoAudioReceived as exc:
        raise ValueError(
            f"音色 {selected_voice} 当前不可用，请更换其他音色后重试"
        ) from exc
    return selected_voice

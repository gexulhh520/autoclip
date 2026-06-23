"""Edge TTS synthesis (Microsoft Edge Read Aloud neural voices)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

DEFAULT_ZH_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_EN_VOICE = "en-US-AriaNeural"

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def guess_voice(text: str, preferred: Optional[str] = None) -> str:
    if preferred and preferred.strip():
        return preferred.strip()
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
    except ImportError as exc:
        raise RuntimeError("未安装 edge-tts，请运行: pip install edge-tts") from exc

    cleaned = text.strip()
    if not cleaned:
        raise ValueError("文本为空")

    selected_voice = guess_voice(cleaned, voice)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(cleaned, selected_voice, rate=rate)
    await communicate.save(str(output_path))
    return selected_voice

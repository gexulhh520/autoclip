"""List Edge TTS Chinese voices (run: python scripts/list_edge_tts_zh_voices.py)."""
import asyncio

import edge_tts


async def main() -> None:
    voices = await edge_tts.list_voices()
    zh = [v for v in voices if v.get("Locale", "").startswith("zh")]
    zh.sort(key=lambda x: (x.get("Locale", ""), x.get("Gender", ""), x.get("ShortName", "")))

    print("Locale\tShortName\tGender\tFriendlyName")
    for v in zh:
        print(
            f"{v.get('Locale')}\t{v.get('ShortName')}\t{v.get('Gender')}\t{v.get('FriendlyName', '')}"
        )


if __name__ == "__main__":
    asyncio.run(main())

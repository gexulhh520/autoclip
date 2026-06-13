"""生成影视感金句 ASS 字幕文件。"""
from __future__ import annotations

import platform
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.pipeline.quote_overlay_composer import QuoteCinemaLayer


def _ass_color(hex_color: str) -> str:
    raw = hex_color.lstrip("#")
    if len(raw) == 6:
        r, g, b = raw[0:2], raw[2:4], raw[4:6]
        return f"&H00{b}{g}{r}"
    return "&H00FFFFFF"


def _escape_ass_text(text: str) -> str:
    return (
        text.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
    )


def _layer_style(role: str) -> Tuple[str, float, bool, int, int]:
    """返回 (style_name, size_scale, bold, outline, shadow)。"""
    mapping = {
        "quote_mark": ("QuoteMark", 0.55, False, 0, 1),
        "tagline_en": ("Tagline", 0.58, False, 0, 1),
        "headline": ("HeadlineGold", 1.0, True, 1, 2),
        "body": ("BodyWhite", 0.72, False, 0, 1),
        "emphasis": ("EmphasisGold", 0.82, True, 0, 1),
    }
    return mapping.get(role, ("BodyWhite", 0.72, False, 0, 1))


def _stack_positions(
    layers: List[QuoteCinemaLayer],
    left: int,
    height: int,
    base_size: int,
    margin_bottom: int,
) -> List[Tuple[int, int]]:
    """自下而上堆叠，保证行距足够、不重叠。"""
    positions: List[Tuple[int, int]] = []
    y_cursor = height - margin_bottom

    for layer in reversed(layers):
        _, size_scale, _, _, _ = _layer_style(layer.role)
        line_height = max(22, int(base_size * size_scale * layer.size_scale * 1.35))
        y_cursor -= line_height
        positions.append((left, y_cursor))

    positions.reverse()
    return positions


def _font_family_name(font_path: Path) -> str:
    stem = font_path.stem.lower()
    mapping = {
        "msyh": "Microsoft YaHei",
        "msyhbd": "Microsoft YaHei",
        "simhei": "SimHei",
        "simsun": "SimSun",
        "segoesc": "Segoe Script",
        "segoepr": "Segoe Print",
        "notosanscjksc": "Noto Sans CJK SC",
        "notosanssc": "Noto Sans SC",
        "sourcehansanssc": "Source Han Sans SC",
        "pingfang": "PingFang SC",
    }
    for key, name in mapping.items():
        if key in stem:
            return name
    return font_path.stem


class AssSubtitleBuilder:
    GOLD = "#E8C872"
    WHITE = "#FFFFFF"

    def __init__(
        self,
        fonts: Dict[str, Path],
        config: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.fonts = fonts
        self.config = config or {}
        self.font_names = {
            "primary": str(
                self.config.get("primary_font_name") or _font_family_name(fonts["primary"])
            ),
            "script": str(
                self.config.get("script_font_name") or _font_family_name(fonts["script"])
            ),
        }

    def build(
        self,
        layers: List[QuoteCinemaLayer],
        output_path: Path,
        *,
        width: int,
        height: int,
        duration_sec: float,
    ) -> Path:
        ass_path = output_path.with_suffix(output_path.suffix + ".overlay.ass")
        start = "0:00:00.00"
        end = self._format_ass_time(max(duration_sec, 0.5))

        margin_left = int(self.config.get("margin_left", max(40, width * 0.055)))
        margin_bottom = int(self.config.get("margin_bottom", max(56, height * 0.11)))
        base_size = int(
            self.config.get(
                "base_font_size",
                max(28, min(36, int(height * 0.048))),
            )
        )

        styles = self._style_block(base_size)
        positions = _stack_positions(layers, margin_left, height, base_size, margin_bottom)

        events = []
        for layer, (x, y) in zip(layers, positions):
            style_name, size_scale, bold, outline, shadow = _layer_style(layer.role)
            size = max(16, int(base_size * size_scale * layer.size_scale))
            is_gold = "gold" in layer.color
            color = _ass_color(self.GOLD if is_gold else self.WHITE)
            font_key = "script" if layer.role == "tagline_en" else "primary"
            font_name = self.font_names[font_key]
            weight = 1 if bold else 0
            text = _escape_ass_text(layer.text)
            override = (
                rf"{{\an7\pos({x},{y})\fn{font_name}\fs{size}\b{weight}"
                rf"\shad{shadow}\bord{outline}"
                rf"\1c{color}\3c&H40000000&\4c&H00000000&}}"
            )
            events.append(f"Dialogue: 0,{start},{end},{style_name},,0,0,0,,{override}{text}")

        content = "\n".join(
            [
                "[Script Info]",
                "Title: AutoClip Quote Cinema",
                "ScriptType: v4.00+",
                "WrapStyle: 0",
                "ScaledBorderAndShadow: yes",
                f"PlayResX: {width}",
                f"PlayResY: {height}",
                "",
                "[V4+ Styles]",
                "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
                styles,
                "",
                "[Events]",
                "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
                *events,
                "",
            ]
        )
        ass_path.write_text(content, encoding="utf-8-sig")
        return ass_path

    def _style_block(self, base_size: int) -> str:
        primary = _ass_color(self.WHITE)
        gold = _ass_color(self.GOLD)
        outline = "&H40000000"
        back = "&H00000000"

        def style(name: str, font_key: str, size: int, color: str, bold: int = 0) -> str:
            font_name = self.font_names[font_key]
            return (
                f"Style: {name},{font_name},{size},{color},{color},{outline},{back},"
                f"{bold},0,0,0,100,100,0,0,1,1,1,7,48,48,36,1"
            )

        return "\n".join(
            [
                style("QuoteMark", "primary", int(base_size * 0.55), primary),
                style("Tagline", "script", int(base_size * 0.58), gold),
                style("HeadlineGold", "primary", int(base_size * 1.0), gold, bold=-1),
                style("BodyWhite", "primary", int(base_size * 0.72), primary),
                style("EmphasisGold", "primary", int(base_size * 0.82), gold, bold=-1),
            ]
        )

    @staticmethod
    def _format_ass_time(seconds: float) -> str:
        total_cs = int(round(seconds * 100))
        cs = total_cs % 100
        total_s = total_cs // 100
        s = total_s % 60
        m = (total_s // 60) % 60
        h = total_s // 3600
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def resolve_cinema_fonts(style_config: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Path]]:
    """解析影视感字幕需要的字体集合。"""
    from backend.utils.video_processor import VideoProcessor

    style_config = style_config or {}
    primary = VideoProcessor._resolve_subtitle_font(style_config)

    script = None
    explicit_script = style_config.get("script_font_file") or style_config.get("script_font_path")
    if explicit_script:
        script_path = Path(str(explicit_script)).expanduser()
        if script_path.exists():
            script = script_path

    system = platform.system().lower()
    if system == "windows":
        windir = Path(__import__("os").environ.get("WINDIR", r"C:\Windows"))
        candidates_script = [
            windir / "Fonts" / "segoesc.ttf",
            windir / "Fonts" / "segoepr.ttf",
        ]
        candidates_bold = [
            windir / "Fonts" / "msyhbd.ttc",
            windir / "Fonts" / "simhei.ttf",
            windir / "Fonts" / "msyh.ttc",
        ]
    elif system == "darwin":
        candidates_script = [
            Path("/System/Library/Fonts/Supplemental/Brush Script.ttf"),
        ]
        candidates_bold = [
            Path("/System/Library/Fonts/PingFang.ttc"),
        ]
    else:
        candidates_script = [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
        candidates_bold = []

    if not script:
        for candidate in candidates_script:
            if candidate.exists():
                script = candidate
                break

    if primary is None:
        for candidate in candidates_bold:
            if candidate.exists():
                primary = candidate
                break

    if not primary:
        return None

    return {
        "primary": primary,
        "script": script or primary,
        "caps": primary,
    }

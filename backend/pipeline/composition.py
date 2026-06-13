"""统一合成描述（OpenCut 思路：预览与导出共用画布几何）。

画布以像素尺寸 canvas_size 为唯一真相；视频默认 contain 适配；
模糊背景为项目级 background=blur（cover + blur）。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Tuple

from backend.schemas.edit_session import EditExportSettings

ASPECT_RATIOS = {
    "16:9": (16, 9),
    "4:3": (4, 3),
    "2.35:1": (47, 20),
    "2:1": (2, 1),
    "1.85:1": (37, 20),
    "9:16": (9, 16),
    "3:4": (3, 4),
    "5.8": (9, 195),
    "1:1": (1, 1),
    "1:2": (1, 2),
}

BackgroundType = Literal["color", "blur"]


@dataclass(frozen=True)
class CanvasSize:
    width: int
    height: int

    @property
    def aspect_ratio(self) -> float:
        return self.width / max(self.height, 1)


@dataclass(frozen=True)
class VisualTransform:
    """OpenCut computeVisualTransform 等价：居中矩形（像素坐标）。"""

    x: float
    y: float
    width: float
    height: float

    @property
    def center_x(self) -> float:
        return self.x + self.width / 2

    @property
    def center_y(self) -> float:
        return self.y + self.height / 2


@dataclass(frozen=True)
class CompositionSpec:
    canvas_size: CanvasSize
    background: BackgroundType
    fit_mode: Literal["contain", "cover", "contain_blur"]
    source_width: int
    source_height: int
    scale_x: float = 1.0
    scale_y: float = 1.0
    position_x: float = 0.0
    position_y: float = 0.0

    @property
    def foreground(self) -> VisualTransform:
        return compute_contain_transform(
            self.canvas_size.width,
            self.canvas_size.height,
            self.source_width,
            self.source_height,
            scale_x=self.scale_x,
            scale_y=self.scale_y,
            position_x=self.position_x,
            position_y=self.position_y,
        )

    @property
    def blur_backdrop(self) -> VisualTransform:
        return compute_cover_transform(
            self.canvas_size.width,
            self.canvas_size.height,
            self.source_width,
            self.source_height,
        )


def _ensure_even(value: int) -> int:
    size = max(2, int(value))
    if size % 2:
        size += 1
    return size


def resolve_canvas_size(
    settings: EditExportSettings,
    source_width: Optional[int] = None,
    source_height: Optional[int] = None,
) -> CanvasSize:
    aspect = settings.aspect

    if aspect == "original":
        if source_width and source_height:
            return CanvasSize(_ensure_even(source_width), _ensure_even(source_height))
        return CanvasSize(1920, 1080)

    if aspect == "custom":
        return CanvasSize(
            _ensure_even(settings.custom_width or 1080),
            _ensure_even(settings.custom_height or 1920),
        )

    rw, rh = ASPECT_RATIOS.get(aspect, (9, 16))
    out_h = _ensure_even(settings.height)
    out_w = _ensure_even(int(out_h * rw / rh))
    return CanvasSize(out_w, out_h)


def resolve_background(settings: EditExportSettings) -> BackgroundType:
    if settings.fit_mode == "contain_blur":
        return "blur"
    return "color"


def normalize_fit_mode(settings: EditExportSettings) -> EditExportSettings:
    if settings.fit_mode == "cover":
        return settings.model_copy(update={"fit_mode": "contain"})
    return settings


def compute_contain_transform(
    canvas_width: int,
    canvas_height: int,
    source_width: int,
    source_height: int,
    *,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    position_x: float = 0.0,
    position_y: float = 0.0,
) -> VisualTransform:
    if source_width <= 0 or source_height <= 0:
        return VisualTransform(0, 0, canvas_width, canvas_height)

    contain_scale = min(canvas_width / source_width, canvas_height / source_height)
    scaled_w = source_width * contain_scale * scale_x
    scaled_h = source_height * contain_scale * scale_y
    abs_w = abs(scaled_w)
    abs_h = abs(scaled_h)
    center_x = canvas_width / 2 + position_x
    center_y = canvas_height / 2 + position_y
    return VisualTransform(
        center_x - abs_w / 2,
        center_y - abs_h / 2,
        abs_w,
        abs_h,
    )


def compute_cover_transform(
    canvas_width: int,
    canvas_height: int,
    source_width: int,
    source_height: int,
) -> VisualTransform:
    if source_width <= 0 or source_height <= 0:
        return VisualTransform(0, 0, canvas_width, canvas_height)

    cover_scale = max(canvas_width / source_width, canvas_height / source_height)
    scaled_w = source_width * cover_scale
    scaled_h = source_height * cover_scale
    return VisualTransform(
        (canvas_width - scaled_w) / 2,
        (canvas_height - scaled_h) / 2,
        scaled_w,
        scaled_h,
    )


def build_composition_spec(
    settings: EditExportSettings,
    source_width: int,
    source_height: int,
) -> CompositionSpec:
    normalized = normalize_fit_mode(settings)
    return CompositionSpec(
        canvas_size=resolve_canvas_size(normalized, source_width, source_height),
        background=resolve_background(normalized),
        fit_mode=normalized.fit_mode,
        source_width=max(1, source_width),
        source_height=max(1, source_height),
    )


def build_frame_ffmpeg_filter(settings: EditExportSettings) -> Optional[str]:
    normalized = normalize_fit_mode(settings)
    if normalized.aspect == "original":
        return None

    canvas = resolve_canvas_size(normalized)
    width, out_height = canvas.width, canvas.height

    if normalized.fit_mode == "contain_blur":
        return (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{out_height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{out_height},boxblur=20:10[blurred];"
            f"[fg]scale={width}:{out_height}:force_original_aspect_ratio=decrease[scaled];"
            f"[blurred][scaled]overlay=(W-w)/2:(H-h)/2,setsar=1"
        )

    return (
        f"scale={width}:{out_height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{out_height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    )


def should_apply_canvas_per_segment(settings: EditExportSettings) -> bool:
    normalized = normalize_fit_mode(settings)
    return normalized.aspect != "original" and normalized.fit_mode == "contain"


def should_apply_canvas_in_final_pass(settings: EditExportSettings) -> bool:
    normalized = normalize_fit_mode(settings)
    return normalized.aspect != "original" and normalized.fit_mode == "contain_blur"


def canvas_size_tuple(settings: EditExportSettings) -> Tuple[int, int]:
    canvas = resolve_canvas_size(settings)
    return canvas.width, canvas.height

"""将连续视频帧拼成 3×2 六宫格，供 Coarse/Fine 多模态输入。"""
from __future__ import annotations

import base64
import io
from typing import List, Sequence, Tuple

from PIL import Image

COLLAGE_GROUP_SIZE = 6
COLLAGE_COLS = 3
COLLAGE_ROWS = 2
COLLAGE_GAP_PX = 2
COLLAGE_BG_COLOR: Tuple[int, int, int] = (0, 0, 0)


def build_collage_frames(
    images: Sequence[Image.Image],
    *,
    group_size: int = COLLAGE_GROUP_SIZE,
    cols: int = COLLAGE_COLS,
    rows: int = COLLAGE_ROWS,
    cell_width: int = 160,
    cell_height: int | None = None,
    gap: int = COLLAGE_GAP_PX,
    bg_color: Tuple[int, int, int] = COLLAGE_BG_COLOR,
) -> List[Image.Image]:
    """每 group_size 帧生成一张 cols×rows 拼图（默认 3×2 六宫格）。"""
    if not images:
        return []
    if cols * rows != group_size:
        raise ValueError("cols * rows 必须等于 group_size")

    cell_h = cell_height if cell_height is not None else max(90, int(cell_width * 9 / 16))
    collage_w = cols * cell_width + (cols - 1) * gap
    collage_h = rows * cell_h + (rows - 1) * gap

    collages: List[Image.Image] = []
    for offset in range(0, len(images), group_size):
        chunk = list(images[offset : offset + group_size])
        collage = Image.new("RGB", (collage_w, collage_h), bg_color)
        for index in range(group_size):
            row, col = divmod(index, cols)
            x = col * (cell_width + gap)
            y = row * (cell_h + gap)
            if index < len(chunk):
                cell = _fit_image_in_cell(chunk[index], cell_width, cell_h, bg_color)
            else:
                cell = Image.new("RGB", (cell_width, cell_h), bg_color)
            collage.paste(cell, (x, y))
        collages.append(collage)
    return collages


def _fit_image_in_cell(
    image: Image.Image,
    cell_width: int,
    cell_height: int,
    bg_color: Tuple[int, int, int],
) -> Image.Image:
    canvas = Image.new("RGB", (cell_width, cell_height), bg_color)
    frame = image.convert("RGB")
    frame.thumbnail((cell_width, cell_height), Image.Resampling.LANCZOS)
    x = (cell_width - frame.width) // 2
    y = (cell_height - frame.height) // 2
    canvas.paste(frame, (x, y))
    return canvas


def pil_image_to_jpeg_b64(image: Image.Image, *, quality: int = 85) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def build_collage_b64_list(
    images: Sequence[Image.Image],
    *,
    cell_width: int = 160,
    cell_height: int | None = None,
    group_size: int = COLLAGE_GROUP_SIZE,
) -> List[str]:
    collages = build_collage_frames(
        images,
        group_size=group_size,
        cell_width=cell_width,
        cell_height=cell_height,
    )
    return [pil_image_to_jpeg_b64(collage) for collage in collages]

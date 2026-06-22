"""六宫格拼图单元测试。"""
from PIL import Image

from backend.services.clip_collage_frames import build_collage_b64_list, build_collage_frames


def _solid(w: int, h: int, color: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGB", (w, h), color)


def test_build_collage_frames_54_to_9():
    frames = [_solid(320, 180, (i * 4, 20, 20)) for i in range(54)]
    collages = build_collage_frames(frames, group_size=6, cols=3, rows=2, cell_width=120)
    assert len(collages) == 9
    assert collages[0].width == 3 * 120 + 2 * 2
    assert collages[0].height == 2 * 90 + 2


def test_build_collage_frames_48_to_8():
    frames = [_solid(320, 180, (20, i * 4, 20)) for i in range(48)]
    collages = build_collage_frames(frames)
    assert len(collages) == 8


def test_build_collage_b64_list_nonempty():
    frames = [_solid(160, 90, (10, 10, 10)) for _ in range(6)]
    encoded = build_collage_b64_list(frames, cell_width=120)
    assert len(encoded) == 1
    assert len(encoded[0]) > 100

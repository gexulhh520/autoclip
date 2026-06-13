"""composition 模块测试。"""
from backend.pipeline.composition import (
    build_composition_spec,
    build_frame_ffmpeg_filter,
    compute_contain_transform,
    compute_cover_transform,
    resolve_canvas_size,
)
from backend.schemas.edit_session import EditExportSettings


def test_resolve_canvas_size_portrait():
    settings = EditExportSettings(aspect="9:16", height=1080)
    canvas = resolve_canvas_size(settings)
    assert canvas.width == 608
    assert canvas.height == 1080


def test_contain_transform_landscape_in_portrait_canvas():
    transform = compute_contain_transform(608, 1080, 1920, 1080)
    assert transform.width == 608
    assert transform.height == 342
    assert transform.y == (1080 - 342) / 2


def test_cover_transform_for_blur_backdrop():
    transform = compute_cover_transform(608, 1080, 1920, 1080)
    assert transform.width >= 608
    assert transform.height >= 1080


def test_build_frame_filter_contain_no_crop():
    vf = build_frame_ffmpeg_filter(EditExportSettings(aspect="9:16", height=1080, fit_mode="contain"))
    assert vf is not None
    assert "decrease" in vf
    assert "pad=" in vf
    assert "crop=" not in vf


def test_composition_spec_matches_canvas():
    settings = EditExportSettings(aspect="9:16", height=1080, fit_mode="contain")
    spec = build_composition_spec(settings, 1920, 1080)
    assert spec.canvas_size.width == 608
    assert spec.foreground.width == 608

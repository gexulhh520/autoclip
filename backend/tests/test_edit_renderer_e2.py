"""E2 剪辑导出增强测试。"""

from backend.pipeline.edit_renderer import (
    build_final_video_filter,
    build_frame_filter,
    should_apply_canvas_per_segment,
    target_dimensions,
)
from backend.schemas.edit_session import EditExportSettings, EditSession


def _session(**export_kwargs) -> EditSession:
    return EditSession(
        id="s1",
        project_id="p1",
        name="测试",
        export_settings=EditExportSettings(**export_kwargs),
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )


def test_target_dimensions_portrait():
    width, height = target_dimensions(EditExportSettings(aspect="9:16", height=1080))
    assert width == 608
    assert height == 1080


def test_target_dimensions_custom():
    width, height = target_dimensions(
        EditExportSettings(aspect="custom", custom_width=1280, custom_height=720)
    )
    assert width == 1280
    assert height == 720


def test_build_frame_filter_contain():
    vf = build_frame_filter(EditExportSettings(aspect="9:16", height=1080, fit_mode="contain"))
    assert vf is not None
    assert "force_original_aspect_ratio=decrease" in vf
    assert "pad=" in vf
    assert "setsar=1" in vf
    assert "crop=" not in vf


def test_should_apply_canvas_per_segment():
    assert should_apply_canvas_per_segment(
        EditExportSettings(aspect="9:16", height=1080, fit_mode="contain")
    )
    assert not should_apply_canvas_per_segment(
        EditExportSettings(aspect="9:16", height=1080, fit_mode="contain_blur")
    )
    assert not should_apply_canvas_per_segment(EditExportSettings(aspect="original"))


def test_export_settings_normalizes_cover_to_contain():
    settings = EditExportSettings(aspect="9:16", fit_mode="cover")
    assert settings.fit_mode == "contain"


def test_build_frame_filter_cover():
    vf = build_frame_filter(
        EditExportSettings(aspect="9:16", height=1080, fit_mode="contain"),
        fit_mode="cover",
    )
    assert vf is not None
    assert "scale=" in vf
    assert "crop=" in vf


def test_build_frame_filter_original():
    vf = build_frame_filter(EditExportSettings(aspect="original"))
    assert vf is None


def test_build_frame_filter_contain_blur():
    vf = build_frame_filter(EditExportSettings(aspect="16:9", height=1080, fit_mode="contain_blur"))
    assert vf is not None
    assert "boxblur" in vf
    assert "overlay=" in vf


def test_build_final_video_filter_with_preset():
    session = _session(visual_filter="mono_soft")
    vf = build_final_video_filter(session)
    assert vf is not None
    assert "eq=" in vf


def test_build_final_video_filter_none():
    session = _session(visual_filter="none", fit_mode="contain")
    vf = build_final_video_filter(session, frame_already_applied=True)
    assert vf is None


def test_build_final_video_filter_visual_only_after_segment_frame():
    session = _session(visual_filter="mono_soft", fit_mode="contain")
    vf = build_final_video_filter(session, frame_already_applied=True)
    assert vf is not None
    assert "eq=" in vf
    assert "pad=" not in vf

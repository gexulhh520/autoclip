"""模板字幕位置偏移应同步到 ASS 导出坐标。"""
from backend.pipeline.overlay_pipeline import apply_overlay_position_offsets
from backend.pipeline.quote_overlay_composer import compose_quote_cinema_layers
from backend.utils.ass_subtitle_builder import AssSubtitleBuilder, _stack_positions


def test_apply_overlay_position_offsets_converts_pct_to_pixels():
    config = {"margin_left": 44, "margin_bottom": 72, "alignment": "bottom-left"}
    clip_data = {"position_offset_x_pct": 10.0, "position_offset_y_pct": 5.0}

    merged = apply_overlay_position_offsets(
        config,
        clip_data,
        ref_width=720,
        ref_height=1280,
    )

    assert merged["position_offset_x"] == 72
    assert merged["position_offset_y"] == 64


def test_stack_positions_applies_block_offset():
    layers = compose_quote_cinema_layers(
        {
            "outline": "标题",
            "content": ["正文一", "正文二"],
            "recommend_reason": "理由",
            "overlay_copy": True,
        },
        {"margin_left": 44, "margin_bottom": 72},
    )
    base_positions = _stack_positions(
        layers,
        720,
        1280,
        32,
        72,
        44,
        44,
        {"alignment": "bottom-left"},
    )
    shifted = _stack_positions(
        layers,
        720,
        1280,
        32,
        72,
        44,
        44,
        {
            "alignment": "bottom-left",
            "position_offset_x": 72,
            "position_offset_y": 64,
        },
    )

    assert shifted[0][0] == base_positions[0][0] + 72
    assert shifted[0][1] == base_positions[0][1] - 64

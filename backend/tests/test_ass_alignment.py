from backend.utils.ass_subtitle_builder import AssSubtitleBuilder, _resolve_ass_anchor


def test_resolve_ass_anchor():
    assert _resolve_ass_anchor("bottom-left") == 7
    assert _resolve_ass_anchor("bottom-center") == 8
    assert _resolve_ass_anchor("bottom-right") == 9


def test_ass_builder_writes_center_alignment(tmp_path):
    primary = tmp_path / "msyh.ttc"
    primary.write_bytes(b"font")

    from backend.pipeline.quote_overlay_composer import QuoteCinemaLayer

    layers = [
        QuoteCinemaLayer("headline", "天生我才必有用", "#E8C872", 1.0),
    ]
    builder = AssSubtitleBuilder(
        {"primary": primary, "script": primary, "caps": primary},
        {
            "alignment": "bottom-center",
            "base_font_size": 32,
            "margin_bottom": 72,
        },
    )
    ass_path = builder.build(
        layers,
        tmp_path / "clip.mp4",
        width=720,
        height=1280,
        duration_sec=5.0,
    )
    content = ass_path.read_text(encoding="utf-8-sig")
    assert r"\an8" in content
    assert r"\pos(360," in content

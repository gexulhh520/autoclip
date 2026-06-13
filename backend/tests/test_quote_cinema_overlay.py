from backend.pipeline.quote_overlay_composer import compose_quote_cinema_layers
from backend.utils.ass_subtitle_builder import AssSubtitleBuilder


def test_compose_quote_cinema_layers_are_compact():
    layers = compose_quote_cinema_layers(
        {
            "outline": "宁爱本江一年头，莫恋他国万辆",
            "content": [
                "宁爱本江一年头 莫恋他国万辆",
                "强调知足与守己的立场，拒绝虚妄的宏大。",
            ],
            "recommend_reason": "极具画面感，强烈的对比构建出克制与守心的宏大意境。",
            "generated_title": "莫恋虚妄的宏大！宁爱本江一年头，在真实中寻找内心的守心与克制",
        }
    )

    roles = [layer.role for layer in layers]
    texts = [layer.text for layer in layers]

    assert len(layers) <= 5
    assert roles[0] == "quote_mark"
    assert "headline" in roles
    assert "emphasis" in roles
    assert "莫恋虚妄的宏大" not in texts
    assert all("THE MOMENT" not in t or role == "emphasis" for t, role in zip(texts, roles))


def test_compose_skips_duplicate_body():
    layers = compose_quote_cinema_layers(
        {
            "outline": "真爱相守",
            "recommend_reason": "真爱相守，以青丝喻时光",
        }
    )
    roles = [layer.role for layer in layers]
    assert "body" not in roles


def test_ass_builder_writes_multiline_events(tmp_path):
    primary = tmp_path / "msyh.ttc"
    script = tmp_path / "segoesc.ttf"
    primary.write_bytes(b"font")
    script.write_bytes(b"font")

    layers = compose_quote_cinema_layers(
        {
            "outline": "真爱相守",
            "recommend_reason": "以青丝喻时光，藏着对情的执着",
        }
    )

    builder = AssSubtitleBuilder(
        {"primary": primary, "script": script, "caps": primary},
        {"base_font_size": 32, "margin_left": 44, "margin_bottom": 72},
    )
    ass_path = builder.build(
        layers,
        tmp_path / "clip.mp4",
        width=720,
        height=544,
        duration_sec=5.0,
    )

    content = ass_path.read_text(encoding="utf-8-sig")
    assert "[Events]" in content
    assert "Dialogue:" in content
    assert "真爱相守" in content
    assert "PlayResX: 720" in content
    assert content.count("Dialogue:") == len(layers)

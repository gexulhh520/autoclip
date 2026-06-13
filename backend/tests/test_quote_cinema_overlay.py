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

    assert len(layers) <= 3
    assert roles[0] == "headline"
    assert "quote_mark" not in roles
    assert "emphasis" not in roles
    assert layers[roles.index("headline")].text.startswith("宁爱本江一年头")
    assert any("强调知足与守己" in t for t in texts)


def test_compose_optional_decorative_layers():
    layers = compose_quote_cinema_layers(
        {"content": ["天生我才必有用"]},
        {"show_quote_mark": True, "show_emphasis_line": True, "caps_label": "THE MOMENT"},
    )
    roles = [layer.role for layer in layers]
    assert "quote_mark" in roles
    assert "emphasis" in roles


def test_compose_prefers_timeline_content_over_outline():
    layers = compose_quote_cinema_layers(
        {
            "outline": "摘要标题与要点不同",
            "content": [
                "天生我才必有用",
                "千金散尽还复来",
            ],
        }
    )
    roles = [layer.role for layer in layers]
    texts = [layer.text for layer in layers]
    assert texts[roles.index("headline")] == "天生我才必有用"
    assert "千金散尽还复来" in texts


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


def test_content_priority_outline_before_content():
    layers = compose_quote_cinema_layers(
        {
            "outline": "摘要主句，摘要副句",
            "content": ["要点主句", "要点副句"],
        },
        {"content_priority": ["outline", "content", "recommend_reason"], "max_body_points": 3},
    )
    roles = [layer.role for layer in layers]
    texts = [layer.text for layer in layers]
    assert texts[roles.index("headline")] == "摘要主句"
    assert "要点主句" in texts
    assert "要点副句" in texts


def test_content_priority_outline_only_skips_content():
    layers = compose_quote_cinema_layers(
        {
            "outline": "只用摘要，忽略要点",
            "content": ["不应出现的主句"],
            "recommend_reason": "不应出现的理由",
        },
        {"content_priority": ["outline"]},
    )
    texts = [layer.text for layer in layers]
    assert texts[0] == "只用摘要"
    assert "不应出现的主句" not in texts
    assert "不应出现的理由" not in texts


def test_content_priority_without_recommend_reason():
    layers = compose_quote_cinema_layers(
        {
            "outline": "只有主句",
            "recommend_reason": "这条不应作为 body",
        },
        {"content_priority": ["outline", "content"]},
    )
    roles = [layer.role for layer in layers]
    texts = [layer.text for layer in layers]
    assert texts[roles.index("headline")] == "只有主句"
    assert "body" not in roles
    assert "这条不应作为 body" not in texts

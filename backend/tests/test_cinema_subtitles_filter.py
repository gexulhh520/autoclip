from pathlib import Path

from backend.pipeline.quote_overlay_composer import compose_quote_cinema_layers
from backend.utils.ass_subtitle_builder import AssSubtitleBuilder
from backend.utils.video_processor import VideoProcessor


def test_cinema_subtitles_filter_uses_relative_ass_name(tmp_path, monkeypatch):
    primary = tmp_path / "msyh.ttc"
    script = tmp_path / "segoesc.ttf"
    primary.write_bytes(b"font")
    script.write_bytes(b"font")

    monkeypatch.setattr(
        "backend.utils.ass_subtitle_builder.resolve_cinema_fonts",
        lambda _cfg: {"primary": primary, "script": script, "caps": primary},
    )
    monkeypatch.setattr(
        VideoProcessor,
        "_probe_video_dimensions",
        staticmethod(lambda _path: (720, 544)),
    )

    output_path = tmp_path / "clip.mp4"
    clip_data = {"outline": "宁爱本江一年头", "recommend_reason": "极具画面感"}
    vf = VideoProcessor._build_cinema_subtitles_filter(
        clip_data,
        output_path,
        tmp_path / "input.mp4",
        5.0,
        {},
    )

    assert vf == "subtitles=clip.mp4.overlay.ass"
    assert output_path.with_suffix(output_path.suffix + ".overlay.ass").exists()

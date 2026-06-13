"""静音检测与 trim 建议测试。"""

from backend.pipeline.edit_renderer import (
    suggest_speech_trim,
    suggest_internal_split_points,
    _parse_silencedetect_output,
)


def test_parse_silencedetect_output():
    stderr = """
[silencedetect @ 000] silence_start: 0
[silencedetect @ 000] silence_end: 0.812 | silence_duration: 0.812
[silencedetect @ 000] silence_start: 4.55
[silencedetect @ 000] silence_end: 5.01 | silence_duration: 0.46
"""
    regions = _parse_silencedetect_output(stderr)
    assert len(regions) == 2
    assert regions[0] == (0.0, 0.812)
    assert abs(regions[1][0] - 4.55) < 0.001


def test_suggest_speech_trim_leading_trailing():
    regions = [(0.0, 0.8), (4.5, 5.0)]
    in_sec, out_sec = suggest_speech_trim(regions, 5.0)
    assert in_sec < 0.8
    assert out_sec > 4.5
    assert out_sec - in_sec < 5.0


def test_suggest_speech_trim_no_silence():
    in_sec, out_sec = suggest_speech_trim([], 6.0)
    assert in_sec == 0.0
    assert out_sec == 6.0


def test_suggest_internal_split_points():
    regions = [(0.0, 0.8), (2.0, 2.6), (4.5, 5.0)]
    points = suggest_internal_split_points(regions, 5.0, 10.0)
    assert len(points) == 1
    assert abs(points[0] - (10.0 + 2.3)) < 0.001


def test_suggest_internal_split_points_skips_edges():
    regions = [(0.0, 0.8), (4.5, 5.0)]
    points = suggest_internal_split_points(regions, 5.0, 0.0)
    assert points == []

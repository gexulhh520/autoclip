import json

import pytest

from backend.pipeline.step2_timeline import TimelineExtractor


@pytest.fixture
def extractor(tmp_path):
    return TimelineExtractor(metadata_dir=tmp_path / "metadata")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("01:22:53,375", "01:22:53,375"),
        ("01:22:53.375", "01:22:53,375"),
        ("00:48:35.000", "00:48:35,000"),
        ("01:04:23,876", "01:04:23,876"),
    ],
)
def test_normalize_srt_time(extractor, raw, expected):
    assert extractor._normalize_srt_time(raw) == expected


@pytest.mark.parametrize("raw", ["1:22:53.375", "01:22:53", "bad"])
def test_normalize_srt_time_rejects_invalid(extractor, raw):
    assert extractor._normalize_srt_time(raw) is None


def test_parse_and_validate_accepts_dot_milliseconds(extractor):
    response = json.dumps(
        [
            {
                "outline": "致命的诱惑：我是你的首选",
                "start_time": "01:22:53.375",
                "end_time": "01:23:10.000",
            }
        ],
        ensure_ascii=False,
    )

    items = extractor._parse_and_validate_response(
        response,
        chunk_start="01:20:00,000",
        chunk_end="01:30:00,000",
        chunk_index=3,
    )

    assert len(items) == 1
    assert items[0]["start_time"] == "01:22:53,375"
    assert items[0]["end_time"] == "01:23:10,000"

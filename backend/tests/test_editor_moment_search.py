"""片段检索（文本 + 画面）单元测试。"""
import json

from backend.services.editor_moment_search import (
    MatchedMoment,
    TranscriptSegment,
    VisualFrameHit,
    build_timeline_sample_times_for_moments,
    build_uniform_timeline_sample_times,
    find_moments_in_transcript,
    is_visual_primary_search,
    merge_matched_moments,
    merge_visual_frame_hits,
    needs_visual_text_confirm,
    resolve_search_strategy,
    timeline_sample_to_source_sec,
)


class _FakeLlm:
    def parse_json_response(self, raw: str):
        return json.loads(raw)

    def chat_completion(self, messages, **kwargs):
        system = messages[0]["content"]
        if "画面检索" in system:
            return _Resp(
                json.dumps(
                    {"match_score": 0.9, "matches": True, "reason": "两人格斗"},
                    ensure_ascii=False,
                )
            )
        return _Resp(
            json.dumps(
                {
                    "matches": [
                        {
                            "segment_index": 0,
                            "match_score": 0.88,
                            "match_reason": "富有哲理的独白",
                        }
                    ]
                },
                ensure_ascii=False,
            )
        )


class _Resp:
    def __init__(self, content: str):
        self.content = content


def test_find_moments_in_transcript():
    llm = _FakeLlm()
    segments = [
        TranscriptSegment(0, 5, "人生就像一场修行，苦难是必经之路。", "srt"),
        TranscriptSegment(5, 10, "今天天气不错。", "srt"),
    ]
    hits = find_moments_in_transcript(llm, "富有哲学的话", segments, max_results=3)
    assert len(hits) == 1
    assert "哲学" in hits[0][2] or "修行" in hits[0][0].text


def test_is_visual_primary_search():
    assert is_visual_primary_search("找到所有打斗场景") is True
    assert is_visual_primary_search("找到枪战镜头") is True
    assert is_visual_primary_search("富有哲学的话") is False
    assert resolve_search_strategy("找到所有打斗场景") == "visual_primary"
    assert resolve_search_strategy("找到诗歌片段") == "text_primary"


def test_needs_visual_text_confirm():
    assert needs_visual_text_confirm("找到古诗词片段") is True
    assert needs_visual_text_confirm("找到打斗场面") is False


def test_build_uniform_timeline_sample_times():
    times = build_uniform_timeline_sample_times(10.0, 100.0, 4)
    assert len(times) == 4
    assert times[0] > 10.0
    assert times[-1] < 110.0


def test_build_timeline_sample_times_for_moments():
    moments = [
        MatchedMoment(
            0, 5, 20, 25, 0, 5, "床前明月光", 0.9, "古诗", "srt"
        )
    ]
    times = build_timeline_sample_times_for_moments(moments, frames_per_moment=2)
    assert len(times) == 2
    assert all(20 < t < 25 for t in times)


def test_timeline_sample_to_source_sec():
    block = {
        "trim": {"in_sec": 10.0, "out_sec": 110.0},
        "duration_sec": 100.0,
    }
    source = timeline_sample_to_source_sec(block, 0.0, 100.0, 50.0)
    assert abs(source - 60.0) < 0.01


def test_merge_visual_frame_hits():
    hits = [
        VisualFrameHit(10.0, 0.9, "打斗"),
        VisualFrameHit(12.0, 0.85, "击打"),
        VisualFrameHit(50.0, 0.8, "另一场打斗"),
    ]
    merged = merge_visual_frame_hits(hits, sample_interval_sec=5.0, max_results=5)
    assert len(merged) == 2
    assert merged[0][2] >= 0.8


def test_merge_matched_moments_dedupes_overlap():
    from backend.services.editor_moment_search import MatchedMoment

    a = MatchedMoment(
        0, 5, 0, 5, 0, 5, "a", 0.9, "高", "srt"
    )
    b = MatchedMoment(
        1, 4, 1, 4, 1, 4, "b", 0.7, "低", "srt"
    )
    picked = merge_matched_moments([a, b], 2)
    assert len(picked) == 1
    assert picked[0].match_score == 0.9

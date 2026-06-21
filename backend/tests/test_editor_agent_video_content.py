"""视频内容 map-reduce 分析测试。"""
import json

from backend.schemas.editor_agent import AnalyzeVideoContentFrame, AnalyzeVideoContentRequest
from backend.services.editor_agent_service import EditorAgentService


class _MapReduceFakeLlm:
    def __init__(self):
        self.calls = 0

    def parse_json_response(self, raw: str):
        return json.loads(raw)

    def chat_completion(self, messages, **kwargs):
        self.calls += 1
        system = messages[0]["content"]
        if "单帧画面分析" in system:
            time_sec = 1.0
            user = messages[1].get("content") or ""
            if "time_sec" in user:
                try:
                    meta = json.loads(user.split("Frame meta JSON:\n", 1)[1].split("\n\n", 1)[0])
                    time_sec = float(meta.get("time_sec") or 1.0)
                except (IndexError, json.JSONDecodeError, TypeError, ValueError):
                    pass
            return _FakeResponse(
                json.dumps(
                    {
                        "time_sec": time_sec,
                        "scene_summary": f"画面@{time_sec}s",
                        "subjects": ["人物"],
                        "shot_type": "medium",
                        "scene_type": "talking_head",
                        "mood_hint": "平静",
                    },
                    ensure_ascii=False,
                )
            )
        if "音频节奏分析" in system:
            return _FakeResponse(
                json.dumps(
                    {
                        "start_sec": 0.0,
                        "end_sec": 2.0,
                        "kind": "speech",
                        "rhythm_note": "开场口播",
                        "editing_hint": "可在 2s 后切分",
                    },
                    ensure_ascii=False,
                )
            )
        return _FakeResponse(
            json.dumps(
                {
                    "summary": "人物口播片段",
                    "subjects": ["人物"],
                    "scene_types": ["talking_head"],
                    "visual_pacing": "medium",
                    "mood": "平静",
                    "key_moments": [{"time_sec": 1.0, "description": "人物出镜"}],
                    "editing_suggestions": ["可在 2s 后切分"],
                    "confidence": "high",
                    "frame_observations": [
                        {
                            "time_sec": 1.0,
                            "scene_summary": "画面@1.0s",
                            "subjects": ["人物"],
                            "shot_type": "medium",
                        }
                    ],
                },
                ensure_ascii=False,
            )
        )


class _FakeResponse:
    def __init__(self, content: str):
        self.content = content
        self.model = "fake"
        self.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}


def test_analyze_video_content_map_reduce():
    llm = _MapReduceFakeLlm()
    service = EditorAgentService(llm_manager=llm)
    request = AnalyzeVideoContentRequest(
        block_id="b1",
        block_title="测试片段",
        duration_sec=4.0,
        timeline_start_sec=0.0,
        timeline_end_sec=4.0,
        sample_times_sec=[1.0, 3.0],
        frames=[
            AnalyzeVideoContentFrame(time_sec=1.0, image_base64="img1"),
            AnalyzeVideoContentFrame(time_sec=3.0, image_base64="img2"),
        ],
        audio_analysis={
            "segments": [
                {
                    "kind": "speech",
                    "start_sec": 0.0,
                    "end_sec": 2.0,
                    "duration_sec": 2.0,
                }
            ],
            "silence_region_count": 0,
            "total_silence_sec": 0,
            "speech_ratio": 1.0,
            "split_points": [],
        },
    )
    response = service.analyze_video_content(request)
    assert response.analysis.summary == "人物口播片段"
    assert len(response.analysis.frame_observations) == 1
    assert llm.calls >= 4  # 2 frames + 1 audio + 1 aggregate


def test_fallback_video_content_analysis():
    service = EditorAgentService(llm_manager=_MapReduceFakeLlm())
    from backend.schemas.editor_agent import VideoFrameObservation

    frames = [
        VideoFrameObservation(
            time_sec=1.0,
            scene_summary="人物说话",
            subjects=["人物"],
            shot_type="medium",
        )
    ]
    audio_notes = [{"editing_hint": "切分点 2s"}]
    result = service._fallback_video_content_analysis(
        frames,
        audio_notes,
        {"speech_ratio": 0.8, "split_points": [2.0]},
    )
    assert "人物说话" in result.summary
    assert result.editing_suggestions

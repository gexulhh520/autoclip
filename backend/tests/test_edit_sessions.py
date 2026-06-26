"""EditSession API 与服务测试。"""
import json
from pathlib import Path

import pytest

from backend.pipeline.edit_renderer import preview_block_overlay
from backend.services.edit_session_service import EditSessionService
from backend.services.session_clip_pool_service import list_session_pool_clips


def _write_project_clips(project_dir: Path) -> None:
    metadata_dir = project_dir / "metadata"
    clips_dir = project_dir / "output" / "clips"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    (clips_dir / "1_天生我才必有用.mp4").write_bytes(b"fake")
    (clips_dir / "2_千金散尽还复来.mp4").write_bytes(b"fake")

    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "天生我才必有用",
                    "content": ["天生我才必有用", "千金散尽还复来"],
                    "recommend_reason": "金句",
                    "generated_title": "标题一",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                },
                {
                    "id": "2",
                    "outline": "第二段",
                    "content": ["第二段内容"],
                    "recommend_reason": "理由",
                    "generated_title": "标题二",
                    "start_time": "00:00:10,000",
                    "end_time": "00:00:15,000",
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    (metadata_dir / "template_config.json").write_text(
        json.dumps(
            {
                "template_id": "golden_quote_cinema",
                "template_version": "1.3.0",
                "template_rules": {"subtitle_style": "quote_cinema"},
                "overlay": {
                    "composer": "quote_cinema",
                    "renderer": "ass_stack",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _session_with_timeline_clips(service: EditSessionService, project_id: str, clip_ids: list[str]):
    session = service.create_session(project_id, clip_ids)
    session, _ = service.append_blocks(project_id, session.id, clip_ids)
    return session


def test_create_edit_session_from_metadata(tmp_path, monkeypatch):
    project_id = "edit-session-test"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1", "2"])

    assert session.project_id == project_id
    assert len(session.sequence) == 0
    assert session.template_id == "golden_quote_cinema"
    assert session.overlay_snapshot.get("composer") == "quote_cinema"
    pool = list_session_pool_clips(project_id, session.id)
    assert len(pool) == 2
    assert pool[0]["video_path"].startswith("output/clips/")
    assert pool[0]["content"][0] == "天生我才必有用"
    assert pool[0]["source"] == "pipeline"

    saved = json.loads((project_dir / "edit_sessions" / f"{session.id}.json").read_text(encoding="utf-8"))
    assert saved["schema_version"] == 1


def test_import_clips_to_pool_skips_duplicates(tmp_path, monkeypatch):
    project_id = "edit-session-pool-import"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = service.create_session(project_id, ["1"])
    assert service.import_clips_to_pool(project_id, session.id, ["1", "2"]) == 1
    pool = list_session_pool_clips(project_id, session.id)
    assert len(pool) == 2


def test_resolve_clip_metadata_prefers_disk_overlay_with_original_id():
    from types import SimpleNamespace

    from backend.services.edit_session_service import _resolve_clip_metadata

    clip = SimpleNamespace(
        id="uuid-clip-1",
        title="列表标题",
        clip_metadata={
            "original_id": "1",
            "outline": "旧摘要",
            "content": [],
            "recommend_reason": "",
        },
    )
    metadata_map = {
        "1": {
            "id": "1",
            "outline": "新摘要",
            "content": ["真正的成长", "是学会与自己和解"],
            "recommend_reason": "金句",
            "generated_title": "列表标题",
            "overlay_copy": True,
        }
    }

    merged = _resolve_clip_metadata(clip, metadata_map)

    assert merged["content"][0] == "真正的成长"
    assert merged["content"][1] == "是学会与自己和解"
    assert merged.get("overlay_copy") is True


def test_create_edit_session_prefers_step4_overlay(tmp_path, monkeypatch):
    from types import SimpleNamespace

    project_id = "edit-session-step4-overlay"
    project_dir = tmp_path / "projects" / project_id
    metadata_dir = project_dir / "metadata"
    clips_dir = project_dir / "output" / "clips"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)
    (clips_dir / "1_标题.mp4").write_bytes(b"fake")

    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "旧摘要",
                    "content": [],
                    "recommend_reason": "金句",
                    "generated_title": "标题",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (metadata_dir / "step4_titles.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "outline": "旧摘要",
                    "content": ["真正的成长", "是学会与自己和解"],
                    "overlay_copy": True,
                    "generated_title": "标题",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (metadata_dir / "template_config.json").write_text(
        json.dumps({"template_id": "golden_quote_cinema", "overlay": {"composer": "quote_cinema"}}),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    clip = SimpleNamespace(
        id="uuid-db-clip",
        title="标题",
        start_time=1,
        end_time=5,
        clip_metadata={"original_id": "1", "content": [], "outline": "旧摘要"},
    )

    class _FakeQuery:
        def __init__(self, items):
            self._items = items

        def filter(self, *args, **kwargs):
            return self

        def all(self):
            return self._items

    class _FakeDb:
        def query(self, _model):
            return _FakeQuery([clip])

    service = EditSessionService(db=_FakeDb())
    session = service.create_session(project_id, ["uuid-db-clip"])

    pool = list_session_pool_clips(project_id, session.id)
    assert pool[0]["content"][0] == "真正的成长"
    assert pool[0]["content"][1] == "是学会与自己和解"


def test_resolve_clip_metadata_by_time_window():
    from types import SimpleNamespace

    from backend.services.edit_session_service import _resolve_clip_metadata

    clip = SimpleNamespace(
        id="uuid-db-clip",
        title="标题",
        start_time=12,
        end_time=18,
        clip_metadata={"content": [], "outline": ""},
    )
    metadata_map = {}
    metadata_rows = [
        {
            "id": "7",
            "outline": "摘要",
            "content": ["按时间对齐的旁白"],
            "start_time": "00:00:12,000",
            "end_time": "00:00:18,000",
        }
    ]

    merged = _resolve_clip_metadata(clip, metadata_map, metadata_rows)

    assert merged["content"][0] == "按时间对齐的旁白"


def test_preview_block_overlay_from_session(tmp_path, monkeypatch):
    project_id = "edit-preview-overlay"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = _session_with_timeline_clips(service, project_id, ["1"])
    preview = preview_block_overlay(session, session.sequence[0].id)
    assert preview["layout"] == "cinema"
    assert preview["applicable"] is True


def test_update_edit_session_sequence(tmp_path, monkeypatch):
    project_id = "edit-session-update"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = _session_with_timeline_clips(service, project_id, ["1", "2"])
    sequence = list(reversed(session.sequence))
    from backend.schemas.edit_session import EditSessionUpdateRequest

    updated = service.update_session(
        project_id,
        session.id,
        EditSessionUpdateRequest(name="新名称", sequence=sequence),
    )
    assert updated.name == "新名称"
    assert updated.sequence[0].source_clip_id == session.sequence[1].source_clip_id


def test_update_edit_session_persists_project_v3(tmp_path, monkeypatch):
    project_id = "edit-session-v3"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = _session_with_timeline_clips(service, project_id, ["1"])
    from backend.schemas.edit_session import EditProjectV3Payload, EditSessionUpdateRequest

    project_v3 = EditProjectV3Payload(
        id=session.id,
        project_id=project_id,
        name=session.name,
        scenes=[{"id": "scene_1", "name": "主场景", "tracks": {"main": [], "overlay": [], "audio": []}}],
    )
    updated = service.update_session(
        project_id,
        session.id,
        EditSessionUpdateRequest(schema_version=3, project_v3=project_v3),
    )
    assert updated.schema_version == 3
    assert updated.project_v3 is not None
    assert updated.project_v3.id == session.id

    saved = json.loads((project_dir / "edit_sessions" / f"{session.id}.json").read_text(encoding="utf-8"))
    assert saved.get("schema_version") == 3
    assert saved.get("project_v3", {}).get("id") == session.id


def test_update_edit_session_persists_audio_assets(tmp_path, monkeypatch):
    project_id = "edit-session-audio-lib"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = _session_with_timeline_clips(service, project_id, ["1"])
    from backend.schemas.edit_session import AudioAssetMeta, EditSessionUpdateRequest

    asset = AudioAssetMeta(
        id="audio_asset_test",
        name="test.mp3",
        path="edit_sessions/s1/audio/test.mp3",
        duration_sec=12.5,
    )
    updated = service.update_session(
        project_id,
        session.id,
        EditSessionUpdateRequest(audio_assets=[asset]),
    )
    assert len(updated.audio_assets) == 1
    assert updated.audio_assets[0].id == "audio_asset_test"

    saved = json.loads((project_dir / "edit_sessions" / f"{session.id}.json").read_text(encoding="utf-8"))
    assert len(saved.get("audio_assets", [])) == 1
    assert saved["audio_assets"][0]["name"] == "test.mp3"


def test_import_bgm_from_url_persists_asset(tmp_path, monkeypatch):
    project_id = "edit-session-bgm-url"
    project_dir = tmp_path / "projects" / project_id
    _write_project_clips(project_dir)

    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    service = EditSessionService(db=None)
    session = _session_with_timeline_clips(service, project_id, ["1"])

    def _fake_download(url: str, output_dir, platform_id=None):
        output_dir.mkdir(parents=True, exist_ok=True)
        video_path = output_dir / "video.mp4"
        video_path.write_bytes(b"not-a-real-video")
        return video_path, "测试抖音标题"

    monkeypatch.setattr(
        "backend.services.edit_session_service.download_link_video",
        _fake_download,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.transcode_bgm_to_m4a",
        lambda source, output: False,
    )

    updated = service.import_bgm_from_url(
        project_id,
        session.id,
        "https://v.douyin.com/RBZnW4-92WE/",
    )
    assert len(updated.audio_assets) == 1
    assert "测试抖音标题" in updated.audio_assets[0].name

    session_dir = project_dir / "edit_sessions" / session.id
    assert not list(session_dir.glob("url_import_*"))
    assert not list(session_dir.glob("video.mp4"))


def test_edit_session_accepts_imported_clip_media_type():
    from backend.schemas.edit_session import EditSession

    session = EditSession.model_validate(
        {
            "schema_version": 1,
            "id": "s-import",
            "project_id": "p1",
            "name": "import test",
            "template_id": "golden_quote_cinema",
            "overlay_snapshot": {},
            "sequence": [
                {
                    "id": "b1",
                    "source_clip_id": "import-abc",
                    "title": "导入片段",
                    "media": {
                        "type": "imported_clip",
                        "path": "edit_sessions/s1/media/clip.mp4",
                    },
                    "trim": {"in_sec": 0, "out_sec": 5},
                    "overlay": {"outline": "", "content": [], "recommend_reason": ""},
                    "audio": {"volume": 1},
                    "transition_out": "cut",
                    "duration_sec": 5,
                }
            ],
            "export_settings": {
                "aspect": "9:16",
                "height": 1080,
                "fps": 30,
                "visual_filter": "none",
                "fit_mode": "contain",
            },
            "audio_settings": {
                "bgm_volume": 0.28,
                "fade_in_sec": 0.3,
                "fade_out_sec": 0.3,
                "use_source_video": False,
                "transition_duration_sec": 0.35,
            },
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        }
    )
    assert session.sequence[0].media.type == "imported_clip"


def test_stream_block_media_endpoint(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    project_id = "edit-block-media"
    project_dir = tmp_path / "projects" / project_id
    session_dir = project_dir / "edit_sessions" / "sess1" / "media"
    session_dir.mkdir(parents=True, exist_ok=True)
    video_path = session_dir / "clip.mp4"
    video_path.write_bytes(b"fake-video")

    session_json = {
        "schema_version": 1,
        "id": "sess1",
        "project_id": project_id,
        "name": "import test",
        "template_id": "golden_quote_cinema",
        "overlay_snapshot": {},
        "sequence": [
            {
                "id": "b1",
                "source_clip_id": "import-abc",
                "title": "导入片段",
                "media": {
                    "type": "imported_clip",
                    "path": "edit_sessions/sess1/media/clip.mp4",
                },
                "trim": {"in_sec": 0, "out_sec": 5},
                "overlay": {"outline": "", "content": [], "recommend_reason": ""},
                "audio": {"volume": 1},
                "transition_out": "cut",
                "duration_sec": 5,
            }
        ],
        "export_settings": {
            "aspect": "9:16",
            "height": 1080,
            "fps": 30,
            "visual_filter": "none",
            "fit_mode": "contain",
        },
        "audio_settings": {
            "bgm_volume": 0.28,
            "fade_in_sec": 0.3,
            "fade_out_sec": 0.3,
            "use_source_video": False,
            "transition_duration_sec": 0.35,
        },
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }
    (project_dir / "edit_sessions" / "sess1.json").write_text(
        json.dumps(session_json, ensure_ascii=False),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.core.path_utils.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.api.v1.edit_sessions.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )

    client = TestClient(app)
    response = client.get(
        f"/api/v1/projects/{project_id}/edit-sessions/sess1/blocks/b1/media"
    )
    assert response.status_code == 200
    assert response.content == b"fake-video"


def test_import_media_endpoint(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    project_id = "edit-import-media"
    session_id = "sess-import"
    project_dir = tmp_path / "projects" / project_id
    session_path = project_dir / "edit_sessions" / f"{session_id}.json"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "id": session_id,
                "project_id": project_id,
                "name": "导入测试",
                "overlay_snapshot": {},
                "sequence": [],
                "overlay_elements": [],
                "bookmarks": [],
                "export_settings": {
                    "aspect": "9:16",
                    "height": 1080,
                    "fps": 30,
                    "visual_filter": "none",
                    "fit_mode": "contain",
                },
                "audio_settings": {
                    "bgm_volume": 0.28,
                    "fade_in_sec": 0.3,
                    "fade_out_sec": 0.3,
                    "bgm_duck_enabled": True,
                    "bgm_duck_ratio": 8,
                    "use_source_video": True,
                    "transition_duration_sec": 0.35,
                },
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "backend.core.path_utils.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.api.v1.edit_sessions.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.utils.video_processor.VideoProcessor.probe_video_duration_sec",
        lambda _path, **_kwargs: 12.5,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.EditSessionService.schedule_imported_media_postprocess",
        lambda *_args, **_kwargs: None,
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/import-media",
        files={"file": ("demo.mp4", b"fake-video-bytes", "video/mp4")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["block_id"]
    assert payload["title"] == "demo"
    assert payload["duration_sec"] == 0.0
    assert len(payload["session"]["sequence"]) == 1
    assert payload["session"]["sequence"][0]["media"]["type"] == "imported_clip"

    probe = client.get(
        f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/blocks/{payload['block_id']}/media-probe"
    )
    assert probe.status_code == 200, probe.text
    assert probe.json()["duration_sec"] == 12.5
    assert probe.json()["ready"] is True

    media_dir = project_dir / "edit_sessions" / session_id / "media"
    assert any(media_dir.glob("import-*.mp4"))


def test_import_media_path_endpoint(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    project_id = "edit-import-media-path"
    session_id = "sess-import-path"
    project_dir = tmp_path / "projects" / project_id
    session_path = project_dir / "edit_sessions" / f"{session_id}.json"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "id": session_id,
                "project_id": project_id,
                "name": "路径导入测试",
                "overlay_snapshot": {},
                "sequence": [],
                "overlay_elements": [],
                "bookmarks": [],
                "export_settings": {
                    "aspect": "9:16",
                    "height": 1080,
                    "fps": 30,
                    "visual_filter": "none",
                    "fit_mode": "contain",
                },
                "audio_settings": {
                    "bgm_volume": 0.28,
                    "fade_in_sec": 0.3,
                    "fade_out_sec": 0.3,
                    "bgm_duck_enabled": True,
                    "bgm_duck_ratio": 8,
                    "use_source_video": True,
                    "transition_duration_sec": 0.35,
                },
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    source_video = tmp_path / "source-long.mp4"
    source_video.write_bytes(b"x" * 4096)

    monkeypatch.setattr(
        "backend.core.path_utils.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.api.v1.edit_sessions.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.utils.video_processor.VideoProcessor.probe_video_duration_sec",
        lambda _path, **_kwargs: 42.0,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.EditSessionService.schedule_imported_media_postprocess",
        lambda *_args, **_kwargs: None,
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/import-media-path",
        json={"source_path": str(source_video)},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["title"] == "source-long"
    assert payload["duration_sec"] == 0.0
    assert payload.get("import_method") in {"hardlink", "symlink", "reference"}
    assert len(payload["session"]["sequence"]) == 1

    media_dir = project_dir / "edit_sessions" / session_id / "media"
    method = payload.get("import_method")
    if method in {"hardlink", "symlink"}:
        imported = next(media_dir.glob("import-*.mp4"))
        assert imported.read_bytes() == source_video.read_bytes()
    else:
        media_path = payload["session"]["sequence"][0]["media"]["path"]
        assert Path(media_path) == source_video.resolve()


def test_import_media_path_reference_when_link_fails(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    project_id = "edit-import-media-ref"
    session_id = "sess-import-ref"
    project_dir = tmp_path / "projects" / project_id
    session_path = project_dir / "edit_sessions" / f"{session_id}.json"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "id": session_id,
                "project_id": project_id,
                "name": "引用导入测试",
                "overlay_snapshot": {},
                "sequence": [],
                "overlay_elements": [],
                "bookmarks": [],
                "export_settings": {
                    "aspect": "9:16",
                    "height": 1080,
                    "fps": 30,
                    "visual_filter": "none",
                    "fit_mode": "contain",
                },
                "audio_settings": {
                    "bgm_volume": 0.28,
                    "fade_in_sec": 0.3,
                    "fade_out_sec": 0.3,
                    "bgm_duck_enabled": True,
                    "bgm_duck_ratio": 8,
                    "use_source_video": True,
                    "transition_duration_sec": 0.35,
                },
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    source_video = tmp_path / "external-source.mp4"
    source_video.write_bytes(b"ref")

    monkeypatch.setattr(
        "backend.core.path_utils.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.api.v1.edit_sessions.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.utils.video_processor.VideoProcessor.probe_video_duration_sec",
        lambda _path, **_kwargs: 12.0,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.os.link",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("cross-device")),
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.os.symlink",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("no symlink")),
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.EditSessionService.schedule_imported_media_postprocess",
        lambda *_args, **_kwargs: None,
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/projects/{project_id}/edit-sessions/{session_id}/import-media-path",
        json={"source_path": str(source_video)},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["import_method"] == "reference"
    assert payload["duration_sec"] == 0.0
    assert Path(payload["session"]["sequence"][0]["media"]["path"]).resolve() == source_video.resolve()


def test_resolve_render_window_imported_clip_split_offset(tmp_path, monkeypatch):
    from backend.pipeline.edit_renderer import _resolve_render_window
    from backend.schemas.edit_session import EditBlock, EditBlockMedia, EditBlockTrim, EditBlockOverlay

    project_dir = tmp_path / "proj"
    media = project_dir / "edit_sessions" / "s1" / "media" / "clip.mp4"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_bytes(b"video")

    block = EditBlock(
        id="b2",
        source_clip_id="import-abc",
        title="第二段",
        media=EditBlockMedia(
            type="imported_clip",
            path="edit_sessions/s1/media/clip.mp4",
            source_start_sec=60.0,
        ),
        trim=EditBlockTrim(in_sec=0.0, out_sec=30.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=90.0,
    )

    monkeypatch.setattr(
        "backend.pipeline.edit_renderer._probe_duration",
        lambda _path: 90.0,
    )

    input_video, trim_in, duration = _resolve_render_window(
        project_dir,
        block,
        use_source_video=False,
    )
    assert input_video.resolve() == media.resolve()
    assert trim_in == pytest.approx(60.0)
    assert duration == pytest.approx(30.0)


def test_resolve_render_window_clip_file_start_after_split(tmp_path, monkeypatch):
    from backend.pipeline.edit_renderer import _resolve_render_window
    from backend.schemas.edit_session import EditBlock, EditBlockMedia, EditBlockTrim, EditBlockOverlay

    project_dir = tmp_path / "proj"
    media = project_dir / "output" / "clips" / "a.mp4"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_bytes(b"video")

    block = EditBlock(
        id="b2",
        source_clip_id="c1",
        title="第二段",
        media=EditBlockMedia(
            type="step6_clip",
            path="output/clips/a.mp4",
            clip_file_start_sec=4.0,
        ),
        trim=EditBlockTrim(in_sec=0.0, out_sec=6.0),
        overlay=EditBlockOverlay(outline="", content=[], recommend_reason=""),
        duration_sec=10.0,
    )

    monkeypatch.setattr(
        "backend.pipeline.edit_renderer._probe_duration",
        lambda _path: 10.0,
    )

    input_video, trim_in, duration = _resolve_render_window(
        project_dir,
        block,
        use_source_video=False,
    )
    assert input_video.resolve() == media.resolve()
    assert trim_in == pytest.approx(4.0)
    assert duration == pytest.approx(6.0)

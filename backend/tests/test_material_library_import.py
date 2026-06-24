"""素材库导入剪辑工程测试。"""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.models.base import Base
from backend.models.material_library import MaterialAssetOrigin, MaterialFileStatus, MaterialLibraryAsset


@pytest.fixture
def import_layout(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    project_id = "lib-import-proj"
    session_id = "sess-import-lib"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "edit_sessions").mkdir(parents=True)

    video_rel = "material_library/videos/lib-import1.mp4"
    video_path = data_dir / video_rel
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"fake-library-video")

    session_path = project_dir / "edit_sessions" / f"{session_id}.json"
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

    db_path = data_dir / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)

    db = TestSession()
    db.add(
        MaterialLibraryAsset(
            id="lib-import1",
            title="库内素材",
            origin=MaterialAssetOrigin.EXTERNAL_DOWNLOAD,
            platform="youtube",
            external_id="abc123",
            source_url="https://www.youtube.com/watch?v=abc123",
            video_path=video_rel,
            file_status=MaterialFileStatus.READY,
        )
    )
    db.commit()
    db.close()

    for target in (
        "backend.services.material_library_service",
        "backend.services.material_library_migration",
        "backend.services.material_download_service",
    ):
        monkeypatch.setattr(f"{target}.get_data_directory", lambda: data_dir)
        monkeypatch.setattr(f"{target}.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_library_service._initialized", True)
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
        lambda _path, **_kwargs: 8.0,
    )
    monkeypatch.setattr(
        "backend.services.edit_session_service.EditSessionService.schedule_imported_media_postprocess",
        lambda *_args, **_kwargs: None,
    )

    marker = data_dir / "material_library" / ".migrated_from_json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("done", encoding="utf-8")

    return {
        "project_id": project_id,
        "session_id": session_id,
        "asset_id": "lib-import1",
        "project_dir": project_dir,
    }


def test_import_library_asset_endpoint(import_layout):
    client = TestClient(app)
    response = client.post(
        f"/api/v1/projects/{import_layout['project_id']}/edit-sessions/{import_layout['session_id']}/import-library-asset",
        json={"asset_id": import_layout["asset_id"]},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["block_id"]
    assert payload["title"] == "库内素材"
    assert len(payload["session"]["sequence"]) == 1
    assert payload["session"]["sequence"][0]["media"]["type"] == "imported_clip"


def test_import_library_asset_with_trim(import_layout):
    client = TestClient(app)
    response = client.post(
        f"/api/v1/projects/{import_layout['project_id']}/edit-sessions/{import_layout['session_id']}/import-library-asset",
        json={
            "asset_id": import_layout["asset_id"],
            "trim_in_sec": 1.0,
            "trim_out_sec": 4.0,
        },
    )
    assert response.status_code == 200, response.text
    block = response.json()["session"]["sequence"][0]
    assert block["trim"]["in_sec"] == pytest.approx(1.0)
    assert block["trim"]["out_sec"] == pytest.approx(4.0)
    assert block["duration_sec"] == pytest.approx(3.0)

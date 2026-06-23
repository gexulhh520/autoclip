"""素材库分页与迁移测试。"""
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models.base import Base
from backend.models.material_library import MaterialAssetOrigin, MaterialFileStatus, MaterialLibraryAsset
from backend.services.material_library_migration import migrate_legacy_assets_json_if_needed
from backend.services.material_library_service import delete_library_asset, list_library_assets


@pytest.fixture
def library_env(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "material_library" / "videos").mkdir(parents=True)
    video_rel = "material_library/videos/lib-legacy1.mp4"
    (data_dir / video_rel).write_bytes(b"legacy")

    legacy = [
        {
            "id": "lib-legacy1",
            "title": "Legacy Clip",
            "video_path": video_rel,
            "promoted_at": "2026-01-01T00:00:00+00:00",
            "source_project_id": "p1",
            "source_session_id": "s1",
            "source_clip_id": "c1",
            "metadata": {"source": "test"},
        }
    ]
    (data_dir / "material_library" / "assets.json").write_text(
        json.dumps(legacy, ensure_ascii=False),
        encoding="utf-8",
    )

    db_path = data_dir / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)

    for target in (
        "backend.services.material_library_service",
        "backend.services.material_library_migration",
        "backend.services.material_download_service",
    ):
        monkeypatch.setattr(f"{target}.get_data_directory", lambda: data_dir)
        monkeypatch.setattr(f"{target}.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_search_service.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_library_service._initialized", False)

    return data_dir


def test_migrate_legacy_assets_json(library_env):
    migrated = migrate_legacy_assets_json_if_needed()
    assert migrated == 1
    page = list_library_assets(page=1, page_size=10)
    assert page["total"] == 1
    assert page["items"][0]["title"] == "Legacy Clip"
    assert page["items"][0]["origin"] == MaterialAssetOrigin.SESSION_POOL.value


def test_list_assets_search_and_delete(library_env):
    migrate_legacy_assets_json_if_needed()
    page = list_library_assets(q="Legacy")
    assert page["total"] == 1
    delete_library_asset("lib-legacy1")
    page = list_library_assets()
    assert page["total"] == 0

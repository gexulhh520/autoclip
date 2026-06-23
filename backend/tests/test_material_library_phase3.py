"""素材库 Phase 3：FTS、标签、统计与批量删除。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models.base import Base
from backend.models.material_library import MaterialAssetOrigin, MaterialFileStatus, MaterialLibraryAsset
from backend.repositories.material_library_repository import MaterialLibraryRepository
from backend.services.material_library_fts import search_material_library_fts
from backend.services.material_library_service import (
    delete_library_assets_batch,
    get_library_storage_stats,
    list_library_assets,
    list_library_tags,
    update_library_asset_tags,
)


@pytest.fixture
def library_env(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "material_library" / "videos").mkdir(parents=True)
    (data_dir / "material_library" / "thumbs").mkdir(parents=True)

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
    monkeypatch.setattr("backend.services.material_library_service.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_library_service._initialized", True)

    marker = data_dir / "material_library" / ".migrated_from_json"
    marker.write_text("done", encoding="utf-8")

    db = TestSession()
    repo = MaterialLibraryRepository(db)
    for asset_id, title, tags in (
        ("lib-a1", "城市夜景延时", ["b-roll", "night"]),
        ("lib-a2", "产品开箱演示", ["product"]),
        ("lib-a3", "街头采访片段", ["interview", "street"]),
    ):
        video_rel = f"material_library/videos/{asset_id}.mp4"
        (data_dir / video_rel).write_bytes(b"video")
        repo.create(
            id=asset_id,
            title=title,
            origin=MaterialAssetOrigin.EXTERNAL_DOWNLOAD,
            platform="youtube",
            video_path=video_rel,
            file_size_bytes=1024,
            tags=tags,
            file_status=MaterialFileStatus.READY,
        )
    db.close()
    return data_dir


def test_fts_title_search(library_env):
    db = sessionmaker(bind=create_engine(f"sqlite:///{library_env / 'test.db'}"))()
    try:
        ids = search_material_library_fts(db, "城市")
        assert "lib-a1" in ids
    finally:
        db.close()


def test_list_assets_filter_by_tag(library_env):
    page = list_library_assets(tags=["night"])
    assert page["total"] == 1
    assert page["items"][0]["id"] == "lib-a1"


def test_update_tags_and_list_distinct(library_env):
    updated = update_library_asset_tags("lib-a2", ["product", "demo"])
    assert "demo" in updated["tags"]
    tags = list_library_tags()
    assert "demo" in tags
    assert "night" in tags


def test_storage_stats(library_env):
    stats = get_library_storage_stats()
    assert stats["total_assets"] == 3
    assert stats["total_bytes"] == 3072
    assert stats["by_platform"]["youtube"]["count"] == 3


def test_batch_delete(library_env):
    result = delete_library_assets_batch(["lib-a1", "lib-a2", "missing"])
    assert set(result["deleted"]) == {"lib-a1", "lib-a2"}
    assert len(result["errors"]) == 1
    page = list_library_assets()
    assert page["total"] == 1
    assert page["items"][0]["id"] == "lib-a3"

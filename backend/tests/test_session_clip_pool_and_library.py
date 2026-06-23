"""草稿素材池与全局素材库测试。"""
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models.base import Base
from backend.services.material_library_service import (
    list_library_assets,
    promote_session_clip_to_library,
    resolve_library_video_path,
)
from backend.services.session_clip_pool_service import (
    append_session_pool_clip,
    delete_session_pool_assets,
    list_session_pool_clips,
    resolve_session_pool_video_path,
)


@pytest.fixture
def project_layout(tmp_path, monkeypatch):
    project_id = "pool-test"
    session_id = "sess-abc"
    project_dir = tmp_path / "projects" / project_id
    data_dir = tmp_path / "data"
    project_dir.mkdir(parents=True)
    data_dir.mkdir(parents=True)

    db_path = data_dir / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)

    monkeypatch.setattr(
        "backend.services.session_clip_pool_service.get_project_directory",
        lambda _pid: project_dir,
    )
    monkeypatch.setattr(
        "backend.services.material_library_service.get_data_directory",
        lambda: data_dir,
    )
    monkeypatch.setattr(
        "backend.services.material_library_migration.get_data_directory",
        lambda: data_dir,
    )
    monkeypatch.setattr("backend.services.material_library_service.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_library_migration.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_search_service.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_download_service.SessionLocal", TestSession)
    monkeypatch.setattr("backend.services.material_library_service._initialized", True)

    pool_dir = project_dir / "edit_sessions" / session_id / "pool"
    pool_dir.mkdir(parents=True)
    video_name = "moment-clip1_test.mp4"
    video_path = pool_dir / video_name
    video_path.write_bytes(b"fake-video-bytes")

    clip_id = "moment-clip1"
    append_session_pool_clip(
        project_id,
        session_id,
        {
            "id": clip_id,
            "generated_title": "测试金句",
            "outline": "测试金句",
            "video_path": f"edit_sessions/{session_id}/pool/{video_name}",
            "scope": "session",
            "in_library": False,
            "library_asset_id": None,
        },
    )

    return {
        "project_id": project_id,
        "session_id": session_id,
        "project_dir": project_dir,
        "data_dir": data_dir,
        "clip_id": clip_id,
        "video_path": video_path,
    }


def test_session_pool_list_and_resolve(project_layout):
    clips = list_session_pool_clips(project_layout["project_id"], project_layout["session_id"])
    assert len(clips) == 1
    assert clips[0]["id"] == project_layout["clip_id"]

    resolved = resolve_session_pool_video_path(
        project_layout["project_id"],
        project_layout["session_id"],
        project_layout["clip_id"],
    )
    assert resolved == project_layout["video_path"]


def test_promote_to_library_copies_video(project_layout):
    asset = promote_session_clip_to_library(
        project_layout["project_id"],
        project_layout["session_id"],
        project_layout["clip_id"],
    )
    assert asset["id"].startswith("lib-")
    assert asset["source_clip_id"] == project_layout["clip_id"]

    library_path = resolve_library_video_path(asset["id"])
    assert library_path is not None
    assert library_path.exists()
    assert library_path.read_bytes() == b"fake-video-bytes"

    pool_clips = list_session_pool_clips(
        project_layout["project_id"],
        project_layout["session_id"]
    )
    assert pool_clips[0]["in_library"] is True
    assert pool_clips[0]["library_asset_id"] == asset["id"]

    page = list_library_assets()
    assert len(page["items"]) == 1


def test_delete_session_pool_skips_promoted_clips(project_layout):
    asset = promote_session_clip_to_library(
        project_layout["project_id"],
        project_layout["session_id"],
        project_layout["clip_id"],
    )

    removed = delete_session_pool_assets(
        project_layout["project_id"],
        project_layout["session_id"],
        skip_library_promoted=True,
    )
    assert removed == 0

    library_path = resolve_library_video_path(asset["id"])
    assert library_path is not None
    assert library_path.exists()

    pool_dir = (
        project_layout["project_dir"]
        / "edit_sessions"
        / project_layout["session_id"]
        / "pool"
    )
    assert not pool_dir.exists()


def test_delete_session_pool_removes_unpromoted_clips(project_layout):
    removed = delete_session_pool_assets(
        project_layout["project_id"],
        project_layout["session_id"],
        skip_library_promoted=True,
    )
    assert removed == 1
    assert not project_layout["video_path"].exists()


def test_delete_single_session_pool_clip(project_layout):
    from backend.services.session_clip_pool_service import (
        delete_session_pool_clip,
        list_session_pool_clips,
    )

    delete_session_pool_clip(
        project_layout["project_id"],
        project_layout["session_id"],
        project_layout["clip_id"],
    )
    assert list_session_pool_clips(
        project_layout["project_id"],
        project_layout["session_id"]
    ) == []
    assert not project_layout["video_path"].exists()

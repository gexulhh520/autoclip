"""素材库本地文件导入测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models.base import Base
from backend.services.material_library_service import import_local_file_to_library, list_library_assets


@pytest.fixture
def library_env(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "material_library" / "videos").mkdir(parents=True)
    local_video = tmp_path / "sample.mp4"
    local_video.write_bytes(b"local-video-bytes")

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
    monkeypatch.setattr("backend.services.material_library_service._initialized", True)

    marker = data_dir / "material_library" / ".migrated_from_json"
    marker.write_text("done", encoding="utf-8")
    return {"data_dir": data_dir, "local_video": local_video}


def test_import_local_file_to_library(library_env):
    asset = import_local_file_to_library(str(library_env["local_video"]), title="本地样片")
    assert asset["id"].startswith("lib-")
    assert asset["title"] == "本地样片"
    assert asset["origin"] == "local_import"
    assert asset["platform"] == "local"

    page = list_library_assets()
    assert page["total"] == 1
    path = library_env["data_dir"] / asset["video_path"]
    assert path.exists()
    assert path.read_bytes() == b"local-video-bytes"

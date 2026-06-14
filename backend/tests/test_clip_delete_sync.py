"""切片删除后不应被文件系统同步重新导入。"""
import json
from pathlib import Path

import pytest

from backend.core.database import get_db, init_database, reset_database
from backend.models.clip import Clip, ClipStatus
from backend.models.project import Project, ProjectStatus, ProjectType
from backend.services.clip_service import ClipService
from backend.services.data_sync_service import DataSyncService


def _write_project_with_clips(project_dir: Path) -> None:
    metadata_dir = project_dir / "metadata"
    clips_dir = project_dir / "output" / "clips"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    (clips_dir / "1_标题一.mp4").write_bytes(b"fake")
    (clips_dir / "2_标题二.mp4").write_bytes(b"fake")

    (metadata_dir / "clips_metadata.json").write_text(
        json.dumps(
            [
                {
                    "id": "1",
                    "generated_title": "标题一",
                    "recommend_reason": "理由一",
                    "start_time": "00:00:01,000",
                    "end_time": "00:00:05,000",
                    "final_score": 0.9,
                },
                {
                    "id": "2",
                    "generated_title": "标题二",
                    "recommend_reason": "理由二",
                    "start_time": "00:00:10,000",
                    "end_time": "00:00:15,000",
                    "final_score": 0.8,
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


class TestClipDeleteSync:
    @pytest.fixture(autouse=True)
    def setup_database(self):
        reset_database()
        init_database()
        yield
        reset_database()

    def test_deleted_clip_is_not_resynced(self, tmp_path, monkeypatch):
        project_id = "clip-delete-sync-test"
        project_dir = tmp_path / "projects" / project_id
        _write_project_with_clips(project_dir)

        monkeypatch.setattr(
            "backend.core.path_utils.get_project_directory",
            lambda _pid: project_dir,
        )

        db = next(get_db())
        project = Project(
            id=project_id,
            name="删除同步测试",
            project_type=ProjectType.KNOWLEDGE,
            status=ProjectStatus.COMPLETED,
        )
        db.add(project)
        db.commit()

        sync_service = DataSyncService(db)
        synced = sync_service._sync_clips_from_filesystem(project_id, project_dir)
        assert synced == 2

        clips = db.query(Clip).filter(Clip.project_id == project_id).all()
        assert len(clips) == 2

        clip_service = ClipService(db)
        target = next(clip for clip in clips if (clip.clip_metadata or {}).get("id") == "1")
        assert clip_service.delete_clip_with_filesystem_update(target.id) is True

        remaining = db.query(Clip).filter(Clip.project_id == project_id).all()
        assert len(remaining) == 1
        assert (remaining[0].clip_metadata or {}).get("id") == "2"

        resynced = sync_service._sync_clips_from_filesystem(project_id, project_dir)
        assert resynced == 0

        after_resync = db.query(Clip).filter(Clip.project_id == project_id).all()
        assert len(after_resync) == 1
        assert (after_resync[0].clip_metadata or {}).get("id") == "2"

        deleted_file = project_dir / "deleted_clips.json"
        assert deleted_file.exists()
        deleted_data = json.loads(deleted_file.read_text(encoding="utf-8"))
        assert "1" in deleted_data["deleted_pipeline_ids"]

"""素材库与下载任务 Repository。"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from backend.models.material_library import (
    MaterialAssetOrigin,
    MaterialDownloadStatus,
    MaterialDownloadTask,
    MaterialFileStatus,
    MaterialLibraryAsset,
)
from backend.repositories.base import BaseRepository


class MaterialLibraryRepository(BaseRepository[MaterialLibraryAsset]):
    def __init__(self, db: Session):
        super().__init__(MaterialLibraryAsset, db)

    def find_ready_by_platform_external(
        self, platform: str, external_id: str
    ) -> Optional[MaterialLibraryAsset]:
        if not platform or not external_id:
            return None
        return (
            self.db.query(self.model)
            .filter(
                self.model.platform == platform,
                self.model.external_id == external_id,
                self.model.file_status == MaterialFileStatus.READY,
            )
            .first()
        )

    def search_assets(
        self,
        *,
        q: Optional[str] = None,
        origin: Optional[MaterialAssetOrigin] = None,
        platform: Optional[str] = None,
        page: int = 1,
        page_size: int = 24,
        sort: str = "created_at_desc",
    ) -> Tuple[List[MaterialLibraryAsset], int]:
        query = self.db.query(self.model).filter(
            self.model.file_status == MaterialFileStatus.READY
        )
        if q:
            pattern = f"%{q.strip()}%"
            query = query.filter(
                or_(
                    self.model.title.ilike(pattern),
                    self.model.uploader.ilike(pattern),
                )
            )
        if origin is not None:
            query = query.filter(self.model.origin == origin)
        if platform:
            query = query.filter(self.model.platform == platform)

        if sort == "title_asc":
            query = query.order_by(self.model.title.asc())
        elif sort == "duration_desc":
            query = query.order_by(desc(self.model.duration_sec))
        else:
            query = query.order_by(desc(self.model.created_at))

        total = query.count()
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        items = query.offset((page - 1) * page_size).limit(page_size).all()
        return items, total

    @staticmethod
    def paginate_meta(total: int, page: int, page_size: int) -> Dict[str, int]:
        total_pages = max(1, math.ceil(total / page_size)) if total else 1
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }


class MaterialDownloadTaskRepository(BaseRepository[MaterialDownloadTask]):
    def __init__(self, db: Session):
        super().__init__(MaterialDownloadTask, db)

    def list_tasks(
        self,
        *,
        status: Optional[MaterialDownloadStatus] = None,
        limit: int = 100,
    ) -> List[MaterialDownloadTask]:
        query = self.db.query(self.model)
        if status is not None:
            query = query.filter(self.model.status == status)
        return query.order_by(desc(self.model.created_at)).limit(limit).all()

    def count_active(self) -> int:
        return (
            self.db.query(func.count(self.model.id))
            .filter(
                self.model.status.in_(
                    [
                        MaterialDownloadStatus.PENDING,
                        MaterialDownloadStatus.DOWNLOADING,
                    ]
                )
            )
            .scalar()
            or 0
        )

    def find_active_by_source(self, platform: str, source_url: str) -> Optional[MaterialDownloadTask]:
        return (
            self.db.query(self.model)
            .filter(
                self.model.platform == platform,
                self.model.source_url == source_url,
                self.model.status.in_(
                    [
                        MaterialDownloadStatus.PENDING,
                        MaterialDownloadStatus.DOWNLOADING,
                    ]
                ),
            )
            .first()
        )

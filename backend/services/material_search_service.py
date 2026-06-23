"""素材搜索（yt-dlp flat extract，不入库）。"""

from __future__ import annotations

import logging
from typing import List, Optional

from backend.core.database import SessionLocal
from backend.repositories.material_library_repository import MaterialLibraryRepository
from backend.utils import ytdlp_core

logger = logging.getLogger(__name__)


def search_materials(
    platform: str,
    query: str,
    limit: int = 20,
    browser: Optional[str] = None,
) -> List[dict]:
    platform_key = (platform or "").strip().lower()
    if platform_key not in ytdlp_core.PLATFORM_SEARCH_KEYS:
        raise ValueError(f"不支持的平台: {platform}")

    ytdlp_core.log_ytdlp_version()
    raw_items = ytdlp_core.search_platform(platform_key, query, limit, browser=browser)

    db = SessionLocal()
    try:
        repo = MaterialLibraryRepository(db)
        enriched: List[dict] = []
        for item in raw_items:
            row = dict(item)
            existing = None
            external_id = row.get("external_id")
            if external_id:
                existing = repo.find_ready_by_platform_external(platform_key, str(external_id))
            row["in_library"] = existing is not None
            row["library_asset_id"] = existing.id if existing else None
            enriched.append(row)
        return enriched
    finally:
        db.close()

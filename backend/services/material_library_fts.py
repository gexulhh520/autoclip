"""素材库 FTS5 全文索引（标题 + 标签）。"""
from __future__ import annotations

import logging
import re
from typing import Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.models.material_library import MaterialLibraryAsset

logger = logging.getLogger(__name__)

_FTS_TABLE = "material_library_assets_fts"


def normalize_tags(raw: Optional[Iterable[str]]) -> List[str]:
    if not raw:
        return []
    seen: set[str] = set()
    normalized: List[str] = []
    for item in raw:
        tag = str(item or "").strip().lower()
        if not tag or tag in seen:
            continue
        tag = tag[:32]
        seen.add(tag)
        normalized.append(tag)
    return normalized


def tags_to_text(tags: Optional[Iterable[str]]) -> str:
    return " ".join(normalize_tags(tags))


def build_fts_query(raw: str) -> str:
    tokens = [token for token in re.split(r"\s+", (raw or "").strip()) if token]
    if not tokens:
        return ""
    parts: List[str] = []
    for token in tokens:
        safe = token.replace('"', '""')
        parts.append(f'"{safe}"*')
    return " OR ".join(parts)


def ensure_material_library_fts(db: Session) -> None:
    db.execute(
        text(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS {_FTS_TABLE} USING fts5(
                asset_id UNINDEXED,
                title,
                tags,
                tokenize='unicode61'
            )
            """
        )
    )
    db.commit()


def backfill_material_library_fts(db: Session) -> None:
    ensure_material_library_fts(db)
    count = db.execute(text(f"SELECT COUNT(*) FROM {_FTS_TABLE}")).scalar() or 0
    asset_count = db.query(MaterialLibraryAsset).count()
    if count >= asset_count and asset_count > 0:
        return
    assets = db.query(MaterialLibraryAsset).all()
    for asset in assets:
        upsert_material_library_fts(db, asset, commit=False)
    db.commit()


def upsert_material_library_fts(
    db: Session,
    asset: MaterialLibraryAsset,
    *,
    commit: bool = True,
) -> None:
    ensure_material_library_fts(db)
    tags = asset.tags if isinstance(asset.tags, list) else []
    db.execute(
        text(f"DELETE FROM {_FTS_TABLE} WHERE asset_id = :asset_id"),
        {"asset_id": asset.id},
    )
    db.execute(
        text(
            f"""
            INSERT INTO {_FTS_TABLE}(asset_id, title, tags)
            VALUES (:asset_id, :title, :tags)
            """
        ),
        {
            "asset_id": asset.id,
            "title": asset.title or "",
            "tags": tags_to_text(tags),
        },
    )
    if commit:
        db.commit()


def delete_material_library_fts(db: Session, asset_id: str, *, commit: bool = True) -> None:
    ensure_material_library_fts(db)
    db.execute(
        text(f"DELETE FROM {_FTS_TABLE} WHERE asset_id = :asset_id"),
        {"asset_id": asset_id},
    )
    if commit:
        db.commit()


def search_material_library_fts(db: Session, raw_query: str, *, limit: int = 500) -> List[str]:
    fts_query = build_fts_query(raw_query)
    if not fts_query:
        return []
    ensure_material_library_fts(db)
    try:
        rows = db.execute(
            text(
                f"""
                SELECT asset_id
                FROM {_FTS_TABLE}
                WHERE {_FTS_TABLE} MATCH :query
                LIMIT :limit
                """
            ),
            {"query": fts_query, "limit": max(1, min(limit, 1000))},
        ).fetchall()
    except Exception as exc:
        logger.warning("素材库 FTS 查询失败: %s", exc)
        return []
    return [str(row[0]) for row in rows if row and row[0]]

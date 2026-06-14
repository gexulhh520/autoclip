"""
切片服务
提供切片相关的业务逻辑操作
"""

from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from ..services.base import BaseService
from ..repositories.clip_repository import ClipRepository
from ..models.clip import Clip
from ..schemas.clip import ClipCreate, ClipUpdate, ClipResponse, ClipListResponse, ClipFilter
from ..schemas.base import PaginationParams, PaginationResponse


class ClipService(BaseService[Clip, ClipCreate, ClipUpdate, ClipResponse]):
    """Clip service with business logic."""
    
    def __init__(self, db: Session):
        repository = ClipRepository(db)
        super().__init__(repository)
        self.db = db
    
    def create_clip(self, clip_data: ClipCreate) -> Clip:
        """Create a new clip with business logic."""
        data = clip_data.model_dump()
        orm_data = {
            "project_id": data["project_id"],
            "title": data["title"],
            "description": data["description"],
            "start_time": int(data["start_time"]) if data["start_time"] is not None else 0,
            "end_time": int(data["end_time"]) if data["end_time"] is not None else 0,
            "duration": int(data["duration"]) if data["duration"] is not None else 0,
            "score": data.get("score"),
            "clip_metadata": data.get("clip_metadata", {}),
            "tags": data.get("tags", [])
        }
        return self.create(**orm_data)
    
    def update_clip(self, clip_id: str, clip_data: ClipUpdate) -> Optional[Clip]:
        """Update a clip with business logic."""
        update_data = {k: v for k, v in clip_data.model_dump().items() if v is not None}
        if not update_data:
            return self.get(clip_id)
        
        return self.update(clip_id, **update_data)
    
    def get_clips_by_project(self, project_id: str, skip: int = 0, limit: int = 100) -> List[Clip]:
        """Get clips by project ID."""
        return self.repository.find_by(project_id=project_id)
    
    def get_clips_paginated(
        self, 
        pagination: PaginationParams,
        filters: Optional[ClipFilter] = None
    ) -> ClipListResponse:
        """Get paginated clips with filtering."""
        if filters and filters.source_id and filters.project_id:
            skip = (pagination.page - 1) * pagination.size
            items = self.repository.get_by_project_and_source(
                filters.project_id,
                filters.source_id,
                skip=skip,
                limit=pagination.size,
            )
            total = self.repository.count_by_project_and_source(
                filters.project_id, filters.source_id
            )
            pages = (total + pagination.size - 1) // pagination.size if pagination.size else 0
            pagination_response = PaginationResponse(
                page=pagination.page,
                size=pagination.size,
                total=total,
                pages=pages,
                has_next=pagination.page < pages,
                has_prev=pagination.page > 1,
            )
            clip_responses = []
            for clip in items:
                status_obj = getattr(clip, 'status', None)
                status_value = status_obj.value if hasattr(status_obj, 'value') else 'pending'
                clip_responses.append(ClipResponse(
                    id=str(clip.id),
                    project_id=str(clip.project_id),
                    title=str(clip.title),
                    description=str(clip.description) if clip.description else None,
                    start_time=getattr(clip, 'start_time', 0),
                    end_time=getattr(clip, 'end_time', 0),
                    duration=int(getattr(clip, 'duration', 0)),
                    score=getattr(clip, 'score', None),
                    status=status_value,
                    video_path=getattr(clip, 'video_path', None),
                    tags=getattr(clip, 'tags', []) or [],
                    clip_metadata=getattr(clip, 'clip_metadata', {}) or {},
                    created_at=getattr(clip, 'created_at', None) if isinstance(getattr(clip, 'created_at', None), (type(None), __import__('datetime').datetime)) else None,
                    updated_at=getattr(clip, 'updated_at', None) if isinstance(getattr(clip, 'updated_at', None), (type(None), __import__('datetime').datetime)) else None,
                    collection_ids=[]
                ))
            return ClipListResponse(items=clip_responses, pagination=pagination_response)

        filter_dict = {}
        if filters:
            filter_data = filters.model_dump()
            filter_dict = {
                k: v for k, v in filter_data.items()
                if v is not None and k != "source_id"
            }
        
        items, pagination_response = self.get_paginated(pagination, filter_dict)
        
        # Convert to response schemas (simplified)
        clip_responses = []
        for clip in items:
            status_obj = getattr(clip, 'status', None)
            status_value = status_obj.value if hasattr(status_obj, 'value') else 'pending'
            
            clip_responses.append(ClipResponse(
                id=str(clip.id),
                project_id=str(clip.project_id),
                title=str(clip.title),
                description=str(clip.description) if clip.description else None,
                start_time=getattr(clip, 'start_time', 0),
                end_time=getattr(clip, 'end_time', 0),
                duration=int(getattr(clip, 'duration', 0)),
                score=getattr(clip, 'score', None),
                status=status_value,
                video_path=getattr(clip, 'video_path', None),
                tags=getattr(clip, 'tags', []) or [],
                clip_metadata=getattr(clip, 'clip_metadata', {}) or {},
                created_at=getattr(clip, 'created_at', None) if isinstance(getattr(clip, 'created_at', None), (type(None), __import__('datetime').datetime)) else None,
                updated_at=getattr(clip, 'updated_at', None) if isinstance(getattr(clip, 'updated_at', None), (type(None), __import__('datetime').datetime)) else None,
                collection_ids=[]
            ))
        
        return ClipListResponse(
            items=clip_responses,
            pagination=pagination_response
        )

    def delete_clip_with_filesystem_update(self, clip_id: str) -> bool:
        """删除切片并记录到文件系统，避免刷新后从 metadata 重新同步回来。"""
        import json
        import logging
        from datetime import datetime
        from ..core.path_utils import get_project_directory

        logger = logging.getLogger(__name__)

        clip = self.get(clip_id)
        if not clip:
            return False

        project_id = clip.project_id
        metadata = clip.clip_metadata or {}
        pipeline_id = str(metadata.get("id") or "")
        fallback_key = f"{clip.title}|{clip.start_time}"

        success = self.delete(clip_id)
        if not success:
            return False

        try:
            project_dir = get_project_directory(project_id)
            deleted_clips_file = project_dir / "deleted_clips.json"

            deleted_pipeline_ids: list[str] = []
            deleted_db_clip_ids: list[str] = []
            deleted_clip_keys: list[str] = []
            if deleted_clips_file.exists():
                try:
                    with open(deleted_clips_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    deleted_pipeline_ids = list(data.get("deleted_pipeline_ids", []))
                    deleted_db_clip_ids = list(data.get("deleted_db_clip_ids", []))
                    deleted_clip_keys = list(data.get("deleted_clip_keys", []))
                except Exception as e:
                    logger.warning(f"读取切片删除记录失败: {e}")

            if pipeline_id and pipeline_id not in deleted_pipeline_ids:
                deleted_pipeline_ids.append(pipeline_id)
            if clip_id not in deleted_db_clip_ids:
                deleted_db_clip_ids.append(clip_id)
            if fallback_key not in deleted_clip_keys:
                deleted_clip_keys.append(fallback_key)

            deleted_data = {
                "deleted_pipeline_ids": deleted_pipeline_ids,
                "deleted_db_clip_ids": deleted_db_clip_ids,
                "deleted_clip_keys": deleted_clip_keys,
                "last_updated": datetime.now().isoformat(),
            }
            with open(deleted_clips_file, "w", encoding="utf-8") as f:
                json.dump(deleted_data, f, ensure_ascii=False, indent=2)

            logger.info(f"已更新切片删除记录: {deleted_clips_file}")
        except Exception as e:
            logger.error(f"更新切片删除记录失败: {e}")

        return True 
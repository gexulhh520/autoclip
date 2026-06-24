"""口播里程碑 C：素材搜索、用户确认、下载入库、语义选段、替换占位画面。"""
from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

from backend.core.llm_manager import get_llm_manager
from backend.core.path_utils import get_project_directory
from backend.schemas.edit_session import EditBlockTrim, EditSession, EditSessionUpdateRequest
from backend.schemas.voiceover_plan import (
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverSearchResult,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
)
from backend.services.edit_session_service import EditSessionService, _edit_sessions_dir, _relative_project_path
from backend.services.material_download_service import create_download_tasks, get_download_task
from backend.services.material_library_service import get_library_asset, resolve_library_video_path
from backend.services.material_search_service import search_materials
from backend.services.voiceover_broll_selection import (
    align_interval_to_target_duration,
    apply_manual_trim_override,
    block_dict_for_search,
    build_broll_search_criteria,
    pick_best_semantic_match,
)
from backend.utils.video_processor import VideoProcessor

logger = logging.getLogger(__name__)


class VoiceoverBrollService:
    def __init__(self, session_service: Optional[EditSessionService] = None):
        self.session_service = session_service or EditSessionService()

    def search_segment_materials(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        *,
        platform: str = "youtube",
        limit: int = 10,
    ) -> Tuple[EditSession, VoiceoverPlan, str]:
        session, plan, segment = self._load_segment(project_id, session_id, segment_id)
        self._ensure_tts_ready(segment)

        queries = [q.strip() for q in (segment.search_queries or []) if q.strip()]
        if not queries and segment.visual_brief.strip():
            queries = [segment.visual_brief.strip()]
        if not queries:
            raise ValueError("请先填写素材搜索词或画面描述")

        per_query = max(3, min(limit, 12))
        merged: List[VoiceoverSearchResult] = []
        seen: set[str] = set()
        for query in queries[:3]:
            items = search_materials(platform, query, per_query)
            for item in items:
                url = str(item.get("url") or "").strip()
                key = url or f"{item.get('platform')}:{item.get('external_id')}"
                if not key or key in seen:
                    continue
                seen.add(key)
                merged.append(
                    VoiceoverSearchResult(
                        platform=str(item.get("platform") or platform),
                        title=str(item.get("title") or "未命名"),
                        url=url,
                        external_id=item.get("external_id"),
                        duration_sec=item.get("duration_sec"),
                        in_library=bool(item.get("in_library")),
                        library_asset_id=item.get("library_asset_id"),
                    )
                )
                if len(merged) >= limit:
                    break
            if len(merged) >= limit:
                break

        segment.broll.search_results = merged[:limit]
        segment.error = None
        plan = self._replace_segment(plan, segment)
        session = self._save_plan(project_id, session_id, plan)
        return session, plan, f"已找到 {len(segment.broll.search_results)} 条候选素材"

    def select_segment_material(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        *,
        library_asset_id: Optional[str] = None,
        search_result: Optional[VoiceoverSearchResult] = None,
        search_result_index: Optional[int] = None,
    ) -> Tuple[EditSession, VoiceoverPlan, str]:
        session, plan, segment = self._load_segment(project_id, session_id, segment_id)
        self._ensure_tts_ready(segment)

        selected: Optional[VoiceoverSearchResult] = None
        if library_asset_id:
            asset = get_library_asset(library_asset_id.strip())
            if asset is None:
                raise ValueError(f"素材库条目不存在: {library_asset_id}")
            selected = VoiceoverSearchResult(
                platform=str(asset.get("platform") or "library"),
                title=str(asset.get("title") or library_asset_id),
                url=str(asset.get("source_url") or ""),
                external_id=asset.get("external_id"),
                duration_sec=asset.get("duration_sec"),
                in_library=True,
                library_asset_id=library_asset_id.strip(),
            )
        elif search_result is not None:
            selected = search_result
        elif search_result_index is not None:
            results = segment.broll.search_results or []
            index = int(search_result_index)
            if index < 0 or index >= len(results):
                raise ValueError("search_result_index 超出范围")
            selected = results[index]
        else:
            raise ValueError("请指定 library_asset_id、search_result 或 search_result_index")

        if not selected.library_asset_id and not selected.url:
            raise ValueError("候选素材缺少 url 或 library_asset_id")

        segment.broll.selected = selected
        segment.error = None
        plan = self._replace_segment(plan, segment)
        session = self._save_plan(project_id, session_id, plan)
        return session, plan, f"已选定素材：{selected.title}"

    def apply_segment_broll(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        *,
        source_in_sec: Optional[float] = None,
        source_out_sec: Optional[float] = None,
        wait_download_timeout_sec: float = 180.0,
    ) -> Tuple[EditSession, VoiceoverPlan, str]:
        session, plan, segment = self._load_segment(project_id, session_id, segment_id)
        self._ensure_tts_ready(segment)

        selected = segment.broll.selected
        if selected is None:
            raise ValueError("请先确认素材候选")

        target_duration = float(segment.tts.duration_sec or 0)
        if target_duration <= 0:
            raise ValueError("该段 TTS 时长无效，请先完成 TTS")

        library_asset_id = self._resolve_library_asset_id(
            selected,
            wait_download_timeout_sec=wait_download_timeout_sec,
        )

        block_id = segment.broll.block_id
        if not block_id:
            session, block_id = self._create_segment_video_block(
                project_id,
                session_id,
                plan,
                segment,
                library_asset_id,
                target_duration_sec=target_duration,
            )
            segment.broll.block_id = block_id
            session = self.session_service.get_session(project_id, session_id)
        else:
            session = self.replace_block_with_library_asset(
                project_id,
                session_id,
                block_id,
                library_asset_id,
            )
        source_duration = self._probe_block_source_duration(project_id, session_id, block_id)

        if source_in_sec is not None and source_out_sec is not None:
            selection = apply_manual_trim_override(
                source_in_sec=source_in_sec,
                source_out_sec=source_out_sec,
                target_duration_sec=target_duration,
                source_duration_sec=source_duration,
                previous_reason=segment.broll.selection_reason or "",
            )
        else:
            selection = self._semantic_select_trim(
                project_id,
                session_id,
                block_id,
                segment=segment,
                source_duration_sec=source_duration,
                target_duration_sec=target_duration,
            )

        session = self._apply_block_trim(
            project_id,
            session_id,
            block_id,
            selection.source_in_sec,
            selection.source_out_sec,
            target_duration,
        )

        segment.broll.library_asset_id = library_asset_id
        segment.broll.source_in_sec = selection.source_in_sec
        segment.broll.source_out_sec = selection.source_out_sec
        segment.broll.selection_reason = selection.selection_reason
        segment.status = VoiceoverSegmentStatus.BROLL_DONE
        segment.error = None

        plan = self._replace_segment(plan, segment)
        if all(item.status == VoiceoverSegmentStatus.BROLL_DONE for item in plan.segments):
            plan.status = VoiceoverPlanStatus.COMPLETED
        session = self._save_plan(project_id, session_id, plan)
        return session, plan, selection.selection_reason

    def _create_segment_video_block(
        self,
        project_id: str,
        session_id: str,
        plan: VoiceoverPlan,
        segment: VoiceoverSegment,
        library_asset_id: str,
        *,
        target_duration_sec: float,
    ) -> Tuple[EditSession, str]:
        self._ensure_broll_insert_order(plan, segment)

        video_path = resolve_library_video_path(library_asset_id)
        if video_path is None:
            raise ValueError(f"素材库视频不存在: {library_asset_id}")

        insert_index = self._resolve_broll_insert_index(plan, segment)
        session, block, _import_method = self.session_service.import_media_from_path(
            project_id,
            session_id,
            str(video_path.resolve()),
            insert_index=insert_index,
            title=f"口播素材-{segment.index}",
        )
        source_duration = self.session_service.probe_imported_block_duration(
            project_id,
            session_id,
            block.id,
        )
        if source_duration <= 0:
            raise ValueError("素材视频时长探测失败")

        trim_out = min(source_duration, target_duration_sec)
        updated_sequence = []
        for item in session.sequence:
            if item.id != block.id:
                updated_sequence.append(item)
                continue
            data = item.model_dump()
            data["trim"] = EditBlockTrim(in_sec=0.0, out_sec=trim_out).model_dump()
            data["duration_sec"] = trim_out
            from backend.schemas.edit_session import EditBlock

            updated_sequence.append(EditBlock.model_validate(data))

        session = self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_sequence),
        )
        return session, block.id

    def replace_block_with_library_asset(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        library_asset_id: str,
    ) -> EditSession:
        video_path = resolve_library_video_path(library_asset_id)
        if video_path is None:
            raise ValueError(f"素材库视频不存在: {library_asset_id}")

        session = self.session_service.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == block_id), None)
        if block is None:
            raise ValueError(f"视频 block 不存在: {block_id}")

        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        media_dir = session_dir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        import_id = f"vo-broll-{uuid.uuid4().hex[:12]}"
        suffix = self.session_service._normalize_import_suffix(video_path.suffix)  # noqa: SLF001
        dest = media_dir / f"{import_id}{suffix}"
        media_file, link_method = self.session_service._prepare_import_video_source(  # noqa: SLF001
            video_path,
            dest,
        )
        rel = _relative_project_path(project_dir, media_file.resolve())
        duration_sec = VideoProcessor.probe_video_duration_sec(media_file)
        if duration_sec <= 0:
            duration_sec = 0.1

        asset_meta = get_library_asset(library_asset_id) or {}
        title = str(asset_meta.get("title") or block.title or "口播素材")[:64]

        updated_blocks = []
        for item in session.sequence:
            if item.id != block_id:
                updated_blocks.append(item)
                continue
            data = item.model_dump()
            data["title"] = title
            media = dict(data.get("media") or {})
            media["type"] = "imported_clip"
            media["path"] = rel
            data["media"] = media
            data["trim"] = EditBlockTrim(in_sec=0.0, out_sec=duration_sec).model_dump()
            data["duration_sec"] = duration_sec
            from backend.schemas.edit_session import EditBlock

            updated_blocks.append(EditBlock.model_validate(data))

        session = self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_blocks),
        )
        self.session_service.schedule_imported_media_postprocess(
            project_id,
            session_id,
            block_id,
            media_file,
        )
        logger.info(
            "口播 B-roll 替换 block=%s asset=%s method=%s",
            block_id,
            library_asset_id,
            link_method,
        )
        return session

    def _semantic_select_trim(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        *,
        segment: VoiceoverSegment,
        source_duration_sec: float,
        target_duration_sec: float,
    ):
        from backend.services.clip_event_detector import search_clip_events

        session = self.session_service.get_session(project_id, session_id)
        block = next(item for item in session.sequence if item.id == block_id)
        project_dir = get_project_directory(project_id)
        rel_path = block.media.path
        block_dict = block_dict_for_search(
            rel_media_path=rel_path,
            source_duration_sec=source_duration_sec,
            block_id=block_id,
        )
        criteria = build_broll_search_criteria(
            visual_brief=segment.visual_brief,
            narration_text=segment.narration_text,
        )
        llm = get_llm_manager()
        matches, meta = search_clip_events(
            llm,
            project_dir,
            block_dict,
            criteria,
            timeline_start_sec=0.0,
            duration_sec=source_duration_sec,
            max_results=8,
            recall_mode="high",
            include_audio=False,
        )
        best = pick_best_semantic_match(matches)
        if best is None:
            engine = meta.get("engine") or "clip_event"
            raise ValueError(
                f"语义选段未找到与「{criteria[:48]}…」匹配的画面区间（{engine}）。"
                "请更换素材、放宽画面描述，或手动指定 in/out"
            )

        return align_interval_to_target_duration(
            match_in_sec=float(best.trim_in_sec),
            match_out_sec=float(best.trim_out_sec),
            target_duration_sec=target_duration_sec,
            source_duration_sec=source_duration_sec,
            match_reason=str(best.match_reason or ""),
            match_score=float(best.match_score or 0),
        )

    def _apply_block_trim(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        trim_in_sec: float,
        trim_out_sec: float,
        timeline_duration_sec: float,
    ) -> EditSession:
        session = self.session_service.get_session(project_id, session_id)
        updated_blocks = []
        for item in session.sequence:
            if item.id != block_id:
                updated_blocks.append(item)
                continue
            data = item.model_dump()
            data["trim"] = EditBlockTrim(
                in_sec=trim_in_sec,
                out_sec=trim_out_sec,
            ).model_dump()
            data["duration_sec"] = timeline_duration_sec
            from backend.schemas.edit_session import EditBlock

            updated_blocks.append(EditBlock.model_validate(data))
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_blocks),
        )

    def _resolve_library_asset_id(
        self,
        selected: VoiceoverSearchResult,
        *,
        wait_download_timeout_sec: float,
    ) -> str:
        if selected.library_asset_id and resolve_library_video_path(selected.library_asset_id):
            return selected.library_asset_id

        if selected.in_library and selected.library_asset_id:
            asset_id = selected.library_asset_id
            if resolve_library_video_path(asset_id):
                return asset_id

        url = (selected.url or "").strip()
        if not url:
            raise ValueError("选定素材缺少下载链接")

        tasks = create_download_tasks(
            [
                {
                    "platform": selected.platform,
                    "url": url,
                    "title": selected.title,
                    "external_id": selected.external_id,
                    "duration_sec": selected.duration_sec,
                }
            ]
        )
        if not tasks:
            asset_id = self._find_library_asset_by_external(selected.platform, selected.external_id)
            if asset_id:
                return asset_id
            raise ValueError("无法创建素材下载任务，请确认链接有效或素材是否已在库中")

        task = tasks[0]
        asset_id = task.get("asset_id")
        if asset_id and resolve_library_video_path(str(asset_id)):
            return str(asset_id)

        task_id = str(task.get("id") or "")
        if not task_id:
            raise ValueError("下载任务创建失败")

        return self.wait_for_material_download(task_id, timeout_sec=wait_download_timeout_sec)

    def _probe_block_source_duration(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
    ) -> float:
        duration = self.session_service.probe_imported_block_duration(
            project_id,
            session_id,
            block_id,
        )
        if duration <= 0:
            raise ValueError("素材时长探测失败")
        return float(duration)

    @staticmethod
    def wait_for_material_download(task_id: str, *, timeout_sec: float = 180.0) -> str:
        deadline = time.time() + max(10.0, float(timeout_sec))
        while time.time() < deadline:
            task = get_download_task(task_id)
            if task is None:
                raise ValueError(f"下载任务不存在: {task_id}")
            status = str(task.get("status") or "")
            if status == "completed":
                asset_id = task.get("asset_id")
                if asset_id and resolve_library_video_path(str(asset_id)):
                    return str(asset_id)
                raise ValueError("下载完成但未找到素材库文件")
            if status == "failed":
                raise ValueError(task.get("error_message") or "素材下载失败")
            if status == "cancelled":
                raise ValueError("素材下载已取消")
            time.sleep(2.0)
        raise ValueError("素材下载超时，请稍后在素材库查看进度后重试")

    @staticmethod
    def _find_library_asset_by_external(
        platform: str,
        external_id: Optional[str],
    ) -> Optional[str]:
        ext = str(external_id or "").strip()
        plat = str(platform or "").strip().lower()
        if not ext or not plat:
            return None
        from backend.core.database import SessionLocal
        from backend.repositories.material_library_repository import MaterialLibraryRepository

        db = SessionLocal()
        try:
            asset = MaterialLibraryRepository(db).find_ready_by_platform_external(plat, ext)
            if asset and resolve_library_video_path(asset.id):
                return asset.id
        finally:
            db.close()
        return None

    def _load_segment(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
    ) -> Tuple[EditSession, VoiceoverPlan, VoiceoverSegment]:
        session = self.session_service.get_session(project_id, session_id)
        plan = session.voiceover_plan
        if plan is None:
            raise ValueError("尚无口播计划")
        segment = next((item for item in plan.segments if item.id == segment_id), None)
        if segment is None:
            raise ValueError(f"分段不存在: {segment_id}")
        return session, plan, segment

    @staticmethod
    def _ensure_tts_ready(segment: VoiceoverSegment) -> None:
        if segment.status not in (
            VoiceoverSegmentStatus.TTS_DONE,
            VoiceoverSegmentStatus.BROLL_DONE,
            VoiceoverSegmentStatus.FAILED,
        ):
            raise ValueError("请先完成该段 TTS")

    @staticmethod
    def _resolve_broll_insert_index(plan: VoiceoverPlan, segment: VoiceoverSegment) -> int:
        return sum(
            1
            for item in plan.segments
            if item.index < segment.index and item.broll.block_id
        )

    @staticmethod
    def _ensure_broll_insert_order(plan: VoiceoverPlan, segment: VoiceoverSegment) -> None:
        for item in sorted(plan.segments, key=lambda seg: seg.index):
            if item.index >= segment.index:
                break
            if item.status == VoiceoverSegmentStatus.TTS_DONE and not item.broll.block_id:
                raise ValueError(
                    f"请先生成第 {item.index} 段视频素材，或按段序从前往后应用"
                )

    def _save_plan(self, project_id: str, session_id: str, plan: VoiceoverPlan) -> EditSession:
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(voiceover_plan=plan),
        )

    @staticmethod
    def _replace_segment(plan: VoiceoverPlan, updated: VoiceoverSegment) -> VoiceoverPlan:
        plan.segments = [
            updated if item.id == updated.id else item for item in plan.segments
        ]
        return plan

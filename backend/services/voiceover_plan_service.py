"""口播 plan 持久化与里程碑 A 业务逻辑。"""
from __future__ import annotations

import logging
import threading
import uuid
from typing import List, Optional

from backend.core.llm_manager import get_llm_manager
from backend.schemas.edit_session import EditSession, EditSessionUpdateRequest
from backend.schemas.voiceover_plan import (
    MAX_VOICEOVER_SEGMENTS,
    VoiceoverApplyBrollRequest,
    VoiceoverBrollApplyStatusResponse,
    VoiceoverExecuteRequest,
    VoiceoverGenerateRequest,
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverRegenerateSegmentRequest,
    VoiceoverSearchMaterialsRequest,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
    VoiceoverSelectMaterialRequest,
    VoiceoverTranslateSearchQueriesRequest,
    VoiceoverUpdatePlanRequest,
    VoiceoverUpdateSegmentSearchQueriesRequest,
)
from backend.services.edit_session_service import EditSessionService
from backend.services.voiceover_broll_apply_job import (
    create_broll_apply_job,
    get_broll_apply_job,
    update_broll_apply_job,
)
from backend.services.voiceover_script_generator import (
    generate_voiceover_plan,
    regenerate_voiceover_segment,
    translate_search_queries,
)
from backend.services.voiceover_broll_service import VoiceoverBrollService
from backend.services.voiceover_orchestrator import VoiceoverOrchestrator

logger = logging.getLogger(__name__)


class VoiceoverPlanService:
    def __init__(
        self,
        session_service: Optional[EditSessionService] = None,
        orchestrator: Optional[VoiceoverOrchestrator] = None,
        broll_service: Optional[VoiceoverBrollService] = None,
    ):
        self.session_service = session_service or EditSessionService()
        self.orchestrator = orchestrator or VoiceoverOrchestrator(self.session_service)
        self.broll_service = broll_service or VoiceoverBrollService(self.session_service)

    def get_plan(self, project_id: str, session_id: str) -> tuple[EditSession, Optional[VoiceoverPlan]]:
        session = self.session_service.get_session(project_id, session_id)
        return session, session.voiceover_plan

    def _save_plan(self, project_id: str, session_id: str, plan: Optional[VoiceoverPlan]) -> EditSession:
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(voiceover_plan=plan),
        )

    @staticmethod
    def _ensure_editable(plan: VoiceoverPlan) -> None:
        if plan.status != VoiceoverPlanStatus.DRAFT:
            raise ValueError("口播脚本已确认或执行中，不可编辑；请先重置为草稿")

    @staticmethod
    def _normalize_segment_indices(segments: List[VoiceoverSegment]) -> List[VoiceoverSegment]:
        ordered = sorted(segments, key=lambda item: item.index)
        for idx, seg in enumerate(ordered, start=1):
            seg.index = idx
        return ordered

    def generate_plan(
        self,
        project_id: str,
        session_id: str,
        payload: VoiceoverGenerateRequest,
    ) -> tuple[EditSession, VoiceoverPlan, str]:
        session, existing = self.get_plan(project_id, session_id)
        if existing and not payload.replace_existing:
            if existing.status != VoiceoverPlanStatus.DRAFT:
                raise ValueError("已有口播计划且非草稿；请勾选 replace_existing 或先重置")
            return session, existing, "已有口播草稿，可直接编辑；勾选「重新生成」可覆盖"

        llm = get_llm_manager()
        plan = generate_voiceover_plan(
            llm,
            payload.user_brief,
            voice_id=payload.voice_id,
            speech_rate=payload.speech_rate,
            existing_plan=existing if payload.replace_existing else None,
        )
        updated = self._save_plan(project_id, session_id, plan)
        return updated, plan, f"已生成 {len(plan.segments)} 段口播脚本"

    def update_plan(
        self,
        project_id: str,
        session_id: str,
        payload: VoiceoverUpdatePlanRequest,
    ) -> EditSession:
        session, existing = self.get_plan(project_id, session_id)
        if existing is None:
            raise ValueError("尚无口播计划")
        if payload.plan.id != existing.id:
            raise ValueError("plan id 不匹配")

        plan = payload.plan
        self._ensure_editable(plan)
        plan.segments = self._normalize_segment_indices(plan.segments)
        if not plan.segments:
            raise ValueError("至少保留 1 个分段")
        if len(plan.segments) > MAX_VOICEOVER_SEGMENTS:
            raise ValueError(f"分段最多 {MAX_VOICEOVER_SEGMENTS} 段")

        plan.status = VoiceoverPlanStatus.DRAFT
        for seg in plan.segments:
            if seg.status != VoiceoverSegmentStatus.DRAFT:
                seg.status = VoiceoverSegmentStatus.DRAFT
        return self._save_plan(project_id, session_id, plan)

    def confirm_plan(self, project_id: str, session_id: str) -> EditSession:
        session, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")
        self._ensure_editable(plan)
        if not plan.segments:
            raise ValueError("口播分段为空")

        for seg in plan.segments:
            text = (seg.narration_text or "").strip()
            if not text:
                raise ValueError(f"第 {seg.index} 段口播文案为空")
            seg.status = VoiceoverSegmentStatus.SCRIPT_CONFIRMED

        plan.status = VoiceoverPlanStatus.CONFIRMED
        return self._save_plan(project_id, session_id, plan)

    def reset_plan_to_draft(self, project_id: str, session_id: str) -> EditSession:
        _, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")
        if plan.status == VoiceoverPlanStatus.EXECUTING:
            raise ValueError("口播执行中，不可重置")

        plan.status = VoiceoverPlanStatus.DRAFT
        for seg in plan.segments:
            seg.status = VoiceoverSegmentStatus.DRAFT
        return self._save_plan(project_id, session_id, plan)

    def delete_plan(self, project_id: str, session_id: str) -> EditSession:
        return self._save_plan(project_id, session_id, None)

    def regenerate_segment(
        self,
        project_id: str,
        session_id: str,
        payload: VoiceoverRegenerateSegmentRequest,
    ) -> EditSession:
        session, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")
        self._ensure_editable(plan)

        llm = get_llm_manager()
        updated_segment = regenerate_voiceover_segment(
            llm,
            plan,
            payload.segment_id,
            payload.instruction,
        )
        plan.segments = [
            updated_segment if seg.id == updated_segment.id else seg for seg in plan.segments
        ]
        plan.status = VoiceoverPlanStatus.DRAFT
        return self._save_plan(project_id, session_id, plan)

    def add_segment(
        self,
        project_id: str,
        session_id: str,
        *,
        after_segment_id: Optional[str] = None,
    ) -> EditSession:
        _, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")
        self._ensure_editable(plan)
        if len(plan.segments) >= MAX_VOICEOVER_SEGMENTS:
            raise ValueError(f"分段最多 {MAX_VOICEOVER_SEGMENTS} 段")

        insert_at = len(plan.segments)
        if after_segment_id:
            for idx, seg in enumerate(plan.segments):
                if seg.id == after_segment_id:
                    insert_at = idx + 1
                    break

        new_seg = VoiceoverSegment(
            id=f"vo-seg-{uuid.uuid4().hex[:12]}",
            index=insert_at + 1,
            narration_text="（待填写口播文案）",
            visual_brief="",
            search_queries=[],
        )
        plan.segments.insert(insert_at, new_seg)
        plan.segments = self._normalize_segment_indices(plan.segments)
        return self._save_plan(project_id, session_id, plan)

    def remove_segment(self, project_id: str, session_id: str, segment_id: str) -> EditSession:
        _, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")
        self._ensure_editable(plan)
        remaining = [seg for seg in plan.segments if seg.id != segment_id]
        if len(remaining) == len(plan.segments):
            raise ValueError(f"分段不存在: {segment_id}")
        if not remaining:
            raise ValueError("至少保留 1 个分段")
        plan.segments = self._normalize_segment_indices(remaining)
        return self._save_plan(project_id, session_id, plan)

    async def execute_plan(
        self,
        project_id: str,
        session_id: str,
        payload: VoiceoverExecuteRequest,
    ) -> tuple[EditSession, VoiceoverPlan, str]:
        return await self.orchestrator.execute_plan(
            project_id,
            session_id,
            placeholder_library_asset_id=payload.placeholder_library_asset_id,
            segment_ids=payload.segment_ids,
        )

    async def execute_segment(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        *,
        placeholder_library_asset_id: Optional[str] = None,
    ) -> tuple[EditSession, VoiceoverPlan, str]:
        return await self.orchestrator.execute_segment(
            project_id,
            session_id,
            segment_id,
            placeholder_library_asset_id=placeholder_library_asset_id,
        )

    def _replace_segment_in_plan(
        self, plan: VoiceoverPlan, segment_id: str, updated: VoiceoverSegment
    ) -> VoiceoverPlan:
        plan.segments = [
            updated if seg.id == segment_id else seg for seg in plan.segments
        ]
        return plan

    def update_segment_search_queries(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        payload: VoiceoverUpdateSegmentSearchQueriesRequest,
    ) -> EditSession:
        _, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")
        if plan.status == VoiceoverPlanStatus.DRAFT:
            raise ValueError("草稿状态下请通过「保存修改」更新搜索词")

        segment = next((seg for seg in plan.segments if seg.id == segment_id), None)
        if segment is None:
            raise ValueError(f"分段不存在: {segment_id}")

        segment.search_queries = payload.search_queries
        plan = self._replace_segment_in_plan(plan, segment_id, segment)
        return self._save_plan(project_id, session_id, plan)

    def translate_segment_search_queries(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        payload: VoiceoverTranslateSearchQueriesRequest,
    ) -> EditSession:
        _, plan = self.get_plan(project_id, session_id)
        if plan is None:
            raise ValueError("尚无口播计划")

        segment = next((seg for seg in plan.segments if seg.id == segment_id), None)
        if segment is None:
            raise ValueError(f"分段不存在: {segment_id}")

        source_queries = payload.search_queries
        if source_queries is None:
            source_queries = list(segment.search_queries or [])
        elif plan.status == VoiceoverPlanStatus.DRAFT:
            segment.search_queries = source_queries
        elif source_queries != segment.search_queries:
            segment.search_queries = source_queries

        llm = get_llm_manager()
        translated = translate_search_queries(
            llm,
            source_queries,
            payload.target_language,
        )
        segment.search_queries = translated
        plan = self._replace_segment_in_plan(plan, segment_id, segment)
        return self._save_plan(project_id, session_id, plan)

    def search_segment_materials(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        payload: VoiceoverSearchMaterialsRequest,
    ) -> tuple[EditSession, VoiceoverPlan, str]:
        return self.broll_service.search_segment_materials(
            project_id,
            session_id,
            segment_id,
            platform=payload.platform,
            limit=payload.limit,
            search_queries=payload.search_queries,
        )

    def select_segment_material(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        payload: VoiceoverSelectMaterialRequest,
    ) -> tuple[EditSession, VoiceoverPlan, str]:
        return self.broll_service.select_segment_material(
            project_id,
            session_id,
            segment_id,
            library_asset_id=payload.library_asset_id,
            search_result=payload.search_result,
            search_result_index=payload.search_result_index,
        )

    def apply_segment_broll(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        payload: VoiceoverApplyBrollRequest,
    ) -> tuple[EditSession, VoiceoverPlan, str]:
        return self.broll_service.apply_segment_broll(
            project_id,
            session_id,
            segment_id,
            source_in_sec=payload.source_in_sec,
            source_out_sec=payload.source_out_sec,
            trim_anchor=payload.trim_anchor,
            library_asset_id=payload.library_asset_id,
            search_result_index=payload.search_result_index,
            wait_download_timeout_sec=payload.wait_download_timeout_sec,
        )

    def start_apply_segment_broll(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        payload: VoiceoverApplyBrollRequest,
    ) -> str:
        job = create_broll_apply_job(project_id, session_id, segment_id)

        def run() -> None:
            try:
                session, plan, note = self.broll_service.apply_segment_broll(
                    project_id,
                    session_id,
                    segment_id,
                    source_in_sec=payload.source_in_sec,
                    source_out_sec=payload.source_out_sec,
                    library_asset_id=payload.library_asset_id,
                    search_result_index=payload.search_result_index,
                    wait_download_timeout_sec=payload.wait_download_timeout_sec,
                    operation_id=job.operation_id,
                )
                update_broll_apply_job(
                    job.operation_id,
                    done=True,
                    failed=False,
                    session=session,
                    plan=plan,
                    note=note,
                )
            except Exception as exc:
                logger.exception(
                    "口播 B-roll 应用失败: %s/%s segment=%s",
                    project_id,
                    session_id,
                    segment_id,
                )
                session = self._mark_segment_broll_apply_failed(
                    project_id,
                    session_id,
                    segment_id,
                    str(exc),
                )
                update_broll_apply_job(
                    job.operation_id,
                    done=True,
                    failed=True,
                    error=str(exc),
                    stage="failed",
                    message=str(exc),
                    session=session,
                    plan=session.voiceover_plan if session else None,
                )

        threading.Thread(target=run, daemon=True, name=f"broll-apply-{segment_id}").start()
        return job.operation_id

    def get_apply_segment_broll_status(
        self, operation_id: str
    ) -> VoiceoverBrollApplyStatusResponse:
        job = get_broll_apply_job(operation_id)
        if job is None:
            raise ValueError("B-roll 应用任务不存在或已过期")
        return VoiceoverBrollApplyStatusResponse(
            operation_id=job.operation_id,
            segment_id=job.segment_id,
            stage=job.stage,
            progress=job.progress,
            message=job.message,
            download_task_id=job.download_task_id,
            download_progress=job.download_progress,
            done=job.done,
            failed=job.failed,
            error=job.error,
            session=job.session,
            plan=job.plan,
            note=job.note,
        )

    def _mark_segment_broll_apply_failed(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        error_message: str,
    ) -> EditSession:
        session = self.session_service.get_session(project_id, session_id)
        plan = session.voiceover_plan
        if plan is None:
            return session
        segment = next((item for item in plan.segments if item.id == segment_id), None)
        if segment is None:
            return session
        updated = segment.model_copy(deep=True)
        updated.error = error_message
        updated.broll.selection_reason = ""
        plan = plan.model_copy(deep=True)
        plan.segments = [
            updated if item.id == segment_id else item for item in plan.segments
        ]
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(voiceover_plan=plan),
        )

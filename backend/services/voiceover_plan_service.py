"""口播 plan 持久化与里程碑 A 业务逻辑。"""
from __future__ import annotations

import uuid
from typing import List, Optional

from backend.core.llm_manager import get_llm_manager
from backend.schemas.edit_session import EditSession, EditSessionUpdateRequest
from backend.schemas.voiceover_plan import (
    MAX_VOICEOVER_SEGMENTS,
    VoiceoverGenerateRequest,
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverRegenerateSegmentRequest,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
    VoiceoverUpdatePlanRequest,
)
from backend.services.edit_session_service import EditSessionService
from backend.services.voiceover_script_generator import (
    generate_voiceover_plan,
    regenerate_voiceover_segment,
)


class VoiceoverPlanService:
    def __init__(self, session_service: Optional[EditSessionService] = None):
        self.session_service = session_service or EditSessionService()

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
            raise ValueError("已有口播草稿；请继续编辑或勾选 replace_existing 重新生成")

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

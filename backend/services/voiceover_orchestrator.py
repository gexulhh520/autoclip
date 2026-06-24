"""口播里程碑 B：TTS 上轨、句/词级字幕、占位画面。"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

from backend.pipeline.scene_builder import build_composition_timeline
from backend.schemas.edit_session import (
    AudioClipElement,
    AudioTrackMeta,
    EditBlockTrim,
    EditOverlayElement,
    EditSession,
    EditSessionUpdateRequest,
)
from backend.schemas.voiceover_plan import (
    VoiceoverPlan,
    VoiceoverPlanStatus,
    VoiceoverSegment,
    VoiceoverSegmentStatus,
    VoiceoverWordTiming,
)
from backend.services.edit_session_service import EditSessionService
from backend.services.material_library_service import resolve_library_video_path
from backend.services.voiceover_subtitle_builder import build_voiceover_overlays
from backend.utils.edge_tts_service import SynthesizedSpeech, synthesize_with_timings

logger = logging.getLogger(__name__)

DEFAULT_AUDIO_TRACK_ID = "default-audio"


class VoiceoverOrchestrator:
    def __init__(self, session_service: Optional[EditSessionService] = None):
        self.session_service = session_service or EditSessionService()

    async def execute_plan(
        self,
        project_id: str,
        session_id: str,
        *,
        placeholder_library_asset_id: str,
        segment_ids: Optional[List[str]] = None,
    ) -> Tuple[EditSession, VoiceoverPlan, str]:
        session, plan = self._load_executable_plan(project_id, session_id)
        asset_id = (placeholder_library_asset_id or plan.placeholder_library_asset_id or "").strip()
        if not asset_id:
            raise ValueError("请选择占位视频素材（素材库）")
        if resolve_library_video_path(asset_id) is None:
            raise ValueError(f"占位素材不存在或文件缺失: {asset_id}")

        plan.placeholder_library_asset_id = asset_id
        plan.status = VoiceoverPlanStatus.EXECUTING
        session = self._save_plan(project_id, session_id, plan)

        ordered = sorted(plan.segments, key=lambda item: item.index)
        targets = self._resolve_target_segments(ordered, segment_ids)
        if not targets:
            raise ValueError("没有可执行的分段（需 script_confirmed 或 failed）")

        executed = 0
        last_error: Optional[str] = None
        for segment in targets:
            try:
                session, plan = await self._execute_segment(
                    project_id,
                    session_id,
                    plan,
                    segment.id,
                    asset_id,
                )
                executed += 1
            except Exception as exc:
                logger.exception("口播分段执行失败: %s", segment.id)
                last_error = str(exc)
                session, plan = self._load_executable_plan(project_id, session_id)
                failed = next((item for item in plan.segments if item.id == segment.id), None)
                if failed is not None:
                    failed.status = VoiceoverSegmentStatus.FAILED
                    failed.error = str(exc)
                    plan = self._replace_segment(plan, failed)
                plan.status = VoiceoverPlanStatus.FAILED
                self._save_plan(project_id, session_id, plan)

        session, plan = self._load_executable_plan(project_id, session_id)
        pending = [
            seg
            for seg in plan.segments
            if seg.status in (VoiceoverSegmentStatus.SCRIPT_CONFIRMED, VoiceoverSegmentStatus.FAILED)
        ]
        all_done = all(
            seg.status == VoiceoverSegmentStatus.TTS_DONE for seg in plan.segments
        )
        if all_done:
            plan.status = VoiceoverPlanStatus.COMPLETED
        elif pending and last_error:
            plan.status = VoiceoverPlanStatus.FAILED
        elif executed > 0:
            plan.status = VoiceoverPlanStatus.EXECUTING
        session = self._save_plan(project_id, session_id, plan)

        if last_error and executed == 0:
            raise ValueError(last_error)

        note = f"已执行 {executed} 段口播 TTS"
        if last_error:
            note += f"；部分失败: {last_error}"
        return session, plan, note

    async def execute_segment(
        self,
        project_id: str,
        session_id: str,
        segment_id: str,
        *,
        placeholder_library_asset_id: Optional[str] = None,
    ) -> Tuple[EditSession, VoiceoverPlan, str]:
        session, plan = self._load_executable_plan(project_id, session_id)
        asset_id = (
            (placeholder_library_asset_id or plan.placeholder_library_asset_id or "").strip()
        )
        if not asset_id:
            raise ValueError("请选择占位视频素材（素材库）")
        plan.placeholder_library_asset_id = asset_id
        plan.status = VoiceoverPlanStatus.EXECUTING
        self._save_plan(project_id, session_id, plan)

        session, plan = await self._execute_segment(
            project_id,
            session_id,
            plan,
            segment_id,
            asset_id,
        )
        all_done = all(
            seg.status == VoiceoverSegmentStatus.TTS_DONE for seg in plan.segments
        )
        plan.status = (
            VoiceoverPlanStatus.COMPLETED
            if all_done
            else VoiceoverPlanStatus.EXECUTING
        )
        session = self._save_plan(project_id, session_id, plan)
        return session, plan, f"第 {self._segment_index(plan, segment_id)} 段 TTS 已完成"

    async def _execute_segment(
        self,
        project_id: str,
        session_id: str,
        plan: VoiceoverPlan,
        segment_id: str,
        placeholder_library_asset_id: str,
    ) -> Tuple[EditSession, VoiceoverPlan]:
        segment = next((item for item in plan.segments if item.id == segment_id), None)
        if segment is None:
            raise ValueError(f"分段不存在: {segment_id}")
        if segment.status not in (
            VoiceoverSegmentStatus.SCRIPT_CONFIRMED,
            VoiceoverSegmentStatus.TTS_DONE,
            VoiceoverSegmentStatus.FAILED,
        ):
            raise ValueError(f"第 {segment.index} 段状态不可执行: {segment.status}")

        session = self.session_service.get_session(project_id, session_id)
        ordered = sorted(plan.segments, key=lambda item: item.index)
        timeline_start = self._resolve_segment_timeline_start(session, ordered, segment)
        insert_index = self._resolve_insert_index(session, segment)

        speech, asset_id = await self._synthesize_segment_tts(
            project_id, session_id, plan, segment
        )
        session = self._cleanup_segment_artifacts(project_id, session_id, segment)

        session, block = self._import_placeholder_block(
            project_id,
            session_id,
            placeholder_library_asset_id,
            insert_index=insert_index,
            audio_duration_sec=speech.duration_sec,
        )
        saved_block_id = block.id
        block_timeline_start = self._block_timeline_start(
            session, saved_block_id, fallback=timeline_start
        )

        overlays = build_voiceover_overlays(
            speech.cues,
            session=session,
            block_id=saved_block_id,
            block_timeline_start_sec=block_timeline_start,
            alignment="sentence",
        )
        audio_clip = self._build_audio_clip(
            speech,
            asset_id=asset_id,
            timeline_start_sec=block_timeline_start,
            block_id=saved_block_id,
        )

        session = self._append_session_elements(
            project_id,
            session_id,
            overlays=overlays,
            audio_clip=audio_clip,
        )

        segment = self._mark_segment_done(
            segment,
            speech,
            asset_id=asset_id,
            block_id=saved_block_id,
            audio_clip_id=audio_clip.id,
            timeline_start_sec=block_timeline_start,
            overlay_ids=[item.id for item in overlays],
            library_asset_id=placeholder_library_asset_id,
        )
        plan = self._replace_segment(plan, segment)
        session = self._save_plan(project_id, session_id, plan)
        return session, plan

    def _load_executable_plan(
        self, project_id: str, session_id: str
    ) -> Tuple[EditSession, VoiceoverPlan]:
        session = self.session_service.get_session(project_id, session_id)
        plan = session.voiceover_plan
        if plan is None:
            raise ValueError("尚无口播计划")
        if plan.status not in (
            VoiceoverPlanStatus.CONFIRMED,
            VoiceoverPlanStatus.EXECUTING,
            VoiceoverPlanStatus.FAILED,
            VoiceoverPlanStatus.COMPLETED,
        ):
            raise ValueError("口播脚本尚未确认")
        return session, plan

    def _save_plan(
        self, project_id: str, session_id: str, plan: VoiceoverPlan
    ) -> EditSession:
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(voiceover_plan=plan),
        )

    @staticmethod
    def _resolve_target_segments(
        ordered: List[VoiceoverSegment],
        segment_ids: Optional[List[str]],
    ) -> List[VoiceoverSegment]:
        if segment_ids:
            wanted = set(segment_ids)
            return [
                seg
                for seg in ordered
                if seg.id in wanted
                and seg.status
                in (
                    VoiceoverSegmentStatus.SCRIPT_CONFIRMED,
                    VoiceoverSegmentStatus.FAILED,
                    VoiceoverSegmentStatus.TTS_DONE,
                )
            ]
        return [
            seg
            for seg in ordered
            if seg.status
            in (VoiceoverSegmentStatus.SCRIPT_CONFIRMED, VoiceoverSegmentStatus.FAILED)
        ]

    @staticmethod
    def _segment_index(plan: VoiceoverPlan, segment_id: str) -> int:
        segment = next((item for item in plan.segments if item.id == segment_id), None)
        return segment.index if segment else 0

    def _resolve_segment_timeline_start(
        self,
        session: EditSession,
        ordered: List[VoiceoverSegment],
        segment: VoiceoverSegment,
    ) -> float:
        if segment.tts.timeline_start_sec is not None and segment.tts.timeline_start_sec >= 0:
            return float(segment.tts.timeline_start_sec)

        base = self._composition_end_sec(session)
        cursor = base
        for item in ordered:
            if item.id == segment.id:
                break
            if item.status == VoiceoverSegmentStatus.TTS_DONE and item.tts.duration_sec:
                cursor += float(item.tts.duration_sec)
        return cursor

    @staticmethod
    def _composition_end_sec(session: EditSession) -> float:
        transition = float(session.audio_settings.transition_duration_sec or 0.35)
        timeline = build_composition_timeline(session.sequence, transition)
        return float(timeline.total_duration_sec)

    @staticmethod
    def _resolve_insert_index(session: EditSession, segment: VoiceoverSegment) -> Optional[int]:
        block_id = segment.broll.block_id
        if not block_id:
            return None
        for index, block in enumerate(session.sequence):
            if block.id == block_id:
                return index
        return None

    def _cleanup_segment_artifacts(
        self,
        project_id: str,
        session_id: str,
        segment: VoiceoverSegment,
    ) -> EditSession:
        session = self.session_service.get_session(project_id, session_id)
        overlay_ids = set(segment.subtitles.overlay_ids or [])
        clip_id = segment.tts.audio_clip_id
        block_id = segment.broll.block_id

        overlays = [
            item
            for item in (session.overlay_elements or [])
            if item.id not in overlay_ids
        ]
        clips = [
            item
            for item in (session.audio_elements or [])
            if not clip_id or item.id != clip_id
        ]
        sequence = [
            item for item in (session.sequence or []) if not block_id or item.id != block_id
        ]

        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                overlay_elements=overlays,
                audio_elements=clips,
                sequence=sequence,
            ),
        )

    async def _synthesize_segment_tts(
        self,
        project_id: str,
        session_id: str,
        plan: VoiceoverPlan,
        segment: VoiceoverSegment,
    ) -> tuple[SynthesizedSpeech, str]:
        from backend.services.edit_session_service import _edit_sessions_dir, get_project_directory

        text = (segment.narration_text or "").strip()
        if not text:
            raise ValueError(f"第 {segment.index} 段口播文案为空")

        project_dir = get_project_directory(project_id)
        session_dir = _edit_sessions_dir(project_dir) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = session_dir / f"vo_tts_{uuid.uuid4().hex}.mp3"

        try:
            speech = await synthesize_with_timings(
                text,
                tmp_path,
                voice=plan.voice_id,
                rate=plan.speech_rate,
            )
            label = text[:24] + ("…" if len(text) > 24 else "")
            display_name = f"口播-{segment.index}-{label}.mp3"
            session = self.session_service.get_session(project_id, session_id)
            session = self._import_tts_asset(
                project_id,
                session_id,
                session,
                tmp_path,
                display_name,
            )
            asset_id = session.audio_assets[-1].id if session.audio_assets else ""
            if not asset_id:
                raise RuntimeError("TTS 音频资源写入失败")
            return speech, asset_id
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    logger.warning("无法删除临时 TTS 文件: %s", tmp_path)

    def _import_tts_asset(
        self,
        project_id: str,
        session_id: str,
        session: EditSession,
        source_path: Path,
        display_name: str,
    ) -> EditSession:
        return self.session_service._import_bgm_from_local_file(  # noqa: SLF001
            project_id,
            session_id,
            session,
            source_path,
            display_name,
            category="sfx",
        )

    def _import_placeholder_block(
        self,
        project_id: str,
        session_id: str,
        library_asset_id: str,
        *,
        insert_index: Optional[int],
        audio_duration_sec: float,
    ):
        video_path = resolve_library_video_path(library_asset_id)
        if video_path is None:
            raise ValueError(f"占位素材不存在: {library_asset_id}")

        session, block, _import_method = self.session_service.import_media_from_path(
            project_id,
            session_id,
            str(video_path.resolve()),
            insert_index=insert_index,
            title=f"口播占位-{library_asset_id[:8]}",
        )
        source_duration = self.session_service.probe_imported_block_duration(
            project_id,
            session_id,
            block.id,
        )
        if source_duration <= 0:
            raise ValueError("占位视频时长探测失败")

        if source_duration + 0.05 < audio_duration_sec:
            raise ValueError(
                f"占位素材时长 {source_duration:.2f}s 短于口播 {audio_duration_sec:.2f}s，请更换更长素材"
            )

        trim_out = min(source_duration, audio_duration_sec)
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
        saved_block_id = block.id
        block = next(item for item in session.sequence if item.id == saved_block_id)
        return session, block

    @staticmethod
    def _block_timeline_start(
        session: EditSession, block_id: str, *, fallback: float
    ) -> float:
        transition = float(session.audio_settings.transition_duration_sec or 0.35)
        timeline = build_composition_timeline(session.sequence, transition)
        for segment in timeline.segments:
            if segment.block.id == block_id:
                return float(segment.composition_start_sec)
        return fallback

    def _build_audio_clip(
        self,
        speech: SynthesizedSpeech,
        *,
        asset_id: str,
        timeline_start_sec: float,
        block_id: str,
    ) -> AudioClipElement:
        duration = max(float(speech.duration_sec), 0.1)
        return AudioClipElement(
            id=f"vo-audio-{uuid.uuid4().hex[:12]}",
            asset_id=asset_id,
            track_id=DEFAULT_AUDIO_TRACK_ID,
            start_sec=timeline_start_sec,
            duration_sec=duration,
            trim_start_sec=0.0,
            trim_end_sec=duration,
            volume=1.0,
            block_id=block_id,
            block_offset_sec=0.0,
        )

    def _append_session_elements(
        self,
        project_id: str,
        session_id: str,
        *,
        overlays: List[EditOverlayElement],
        audio_clip: AudioClipElement,
    ) -> EditSession:
        session = self.session_service.get_session(project_id, session_id)
        tracks = list(session.audio_tracks or [])
        if not any(item.id == DEFAULT_AUDIO_TRACK_ID for item in tracks):
            tracks.append(
                AudioTrackMeta(id=DEFAULT_AUDIO_TRACK_ID, name="Audio", order=0)
            )

        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                overlay_elements=[*(session.overlay_elements or []), *overlays],
                audio_elements=[*(session.audio_elements or []), audio_clip],
                audio_tracks=tracks,
            ),
        )

    @staticmethod
    def _mark_segment_done(
        segment: VoiceoverSegment,
        speech: SynthesizedSpeech,
        *,
        asset_id: str,
        block_id: str,
        audio_clip_id: str,
        timeline_start_sec: float,
        overlay_ids: List[str],
        library_asset_id: str,
    ) -> VoiceoverSegment:
        segment.status = VoiceoverSegmentStatus.TTS_DONE
        segment.error = None
        segment.tts.asset_id = asset_id
        segment.tts.audio_clip_id = audio_clip_id
        segment.tts.duration_sec = float(speech.duration_sec)
        segment.tts.timeline_start_sec = timeline_start_sec
        segment.tts.word_timings = [
            VoiceoverWordTiming(
                text=item.text,
                start_sec=item.start_sec,
                end_sec=item.end_sec,
            )
            for item in speech.word_timings
        ]
        segment.subtitles.overlay_ids = overlay_ids
        segment.subtitles.alignment = "sentence"
        segment.broll.block_id = block_id
        segment.broll.library_asset_id = library_asset_id
        segment.broll.source_in_sec = 0.0
        segment.broll.source_out_sec = float(speech.duration_sec)
        return segment

    @staticmethod
    def _replace_segment(plan: VoiceoverPlan, updated: VoiceoverSegment) -> VoiceoverPlan:
        plan.segments = [
            updated if item.id == updated.id else item for item in plan.segments
        ]
        return plan

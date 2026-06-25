"""口播里程碑 B：TTS 上轨、句/词级字幕；占位画面可选。"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

from backend.pipeline.scene_builder import build_composition_timeline
from backend.schemas.edit_session import (
    AudioClipElement,
    AudioTrackMeta,
    EditBlock,
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
from backend.services.edit_session_service import EditSessionService, get_project_directory
from backend.services.material_library_service import resolve_library_video_path
from backend.services.voiceover_broll_service import VOICEOVER_BROLL_TRACK_ID
from backend.services.voiceover_subtitle_builder import build_voiceover_overlays
from backend.services.voiceover_track_placement import (
    apply_main_track_placement_to_block_data,
    apply_overlay_track_placement_to_block_data,
    migrate_voiceover_blocks_to_main_track,
    resolve_main_track_insert_index,
    should_use_main_track_for_voiceover,
)
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
        placeholder_library_asset_id: Optional[str] = None,
        segment_ids: Optional[List[str]] = None,
    ) -> Tuple[EditSession, VoiceoverPlan, str]:
        session, plan = self._load_executable_plan(project_id, session_id)
        asset_id = (placeholder_library_asset_id or "").strip()
        if asset_id:
            if resolve_library_video_path(asset_id) is None:
                raise ValueError(f"占位素材不存在或文件缺失: {asset_id}")
            plan.placeholder_library_asset_id = asset_id
        plan.status = VoiceoverPlanStatus.EXECUTING
        session = self._save_plan(project_id, session_id, plan)

        ordered = sorted(plan.segments, key=lambda item: item.index)
        targets = sorted(
            self._resolve_target_segments(ordered, segment_ids),
            key=lambda item: item.index,
        )
        if not targets:
            raise ValueError(
                "没有待执行的口播分段。"
                "请先确认脚本（分段状态需为 script_confirmed），"
                "或对各已完成段使用「重新生成本段 TTS + 字幕」。"
            )

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
        asset_id = (placeholder_library_asset_id or "").strip()
        if asset_id:
            if resolve_library_video_path(asset_id) is None:
                raise ValueError(f"占位素材不存在或文件缺失: {asset_id}")
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
        placeholder_library_asset_id: Optional[str] = None,
    ) -> Tuple[EditSession, VoiceoverPlan]:
        segment = next((item for item in plan.segments if item.id == segment_id), None)
        if segment is None:
            raise ValueError(f"分段不存在: {segment_id}")
        if segment.status not in (
            VoiceoverSegmentStatus.SCRIPT_CONFIRMED,
            VoiceoverSegmentStatus.TTS_DONE,
            VoiceoverSegmentStatus.BROLL_DONE,
            VoiceoverSegmentStatus.FAILED,
        ):
            raise ValueError(f"第 {segment.index} 段状态不可执行: {segment.status}")

        session = self.session_service.get_session(project_id, session_id)
        sequence, migrated = migrate_voiceover_blocks_to_main_track(session, plan)
        if migrated:
            session = self.session_service.update_session(
                project_id,
                session_id,
                EditSessionUpdateRequest(sequence=sequence),
            )
        ordered = sorted(plan.segments, key=lambda item: item.index)
        is_rerun = self._is_rerun_segment(segment)
        timeline_start = self._resolve_segment_timeline_start(
            session, ordered, segment, is_rerun=is_rerun
        )
        insert_index = self._resolve_insert_index(session, plan, segment)

        speech, tts_asset_id = await self._synthesize_segment_tts(
            project_id, session_id, plan, segment
        )
        session = self._cleanup_segment_artifacts(project_id, session_id, segment)

        saved_block_id = ""
        element_timeline_start = timeline_start
        preserved_video = False
        trim_in_sec = 0.0
        trim_out_sec = float(speech.duration_sec)
        library_asset_id_for_meta = ""

        existing_block_id = (segment.broll.block_id or "").strip()
        if existing_block_id:
            session, resolved_block_id, trim_in_sec, trim_out_sec = (
                self._align_existing_block_to_audio(
                    project_id,
                    session_id,
                    segment,
                    float(speech.duration_sec),
                )
            )
            if resolved_block_id:
                saved_block_id = resolved_block_id
                preserved_video = True
                if not is_rerun:
                    element_timeline_start = self._block_timeline_start(
                        session, saved_block_id, fallback=timeline_start
                    )

        placeholder_id = (placeholder_library_asset_id or "").strip()
        if not saved_block_id and placeholder_id:
            session, block = self._import_placeholder_block(
                project_id,
                session_id,
                placeholder_id,
                insert_index=insert_index,
                audio_duration_sec=speech.duration_sec,
            )
            saved_block_id = block.id
            trim_in_sec = 0.0
            trim_out_sec = float(block.trim.out_sec or speech.duration_sec)
            library_asset_id_for_meta = placeholder_id
            if not is_rerun:
                element_timeline_start = self._block_timeline_start(
                    session, saved_block_id, fallback=timeline_start
                )

        if is_rerun:
            element_timeline_start = timeline_start
            if saved_block_id:
                session = self._sync_voiceover_block_timeline(
                    project_id,
                    session_id,
                    saved_block_id,
                    timeline_start_sec=element_timeline_start,
                    duration_sec=float(speech.duration_sec),
                    trim_in_sec=trim_in_sec,
                    trim_out_sec=trim_out_sec,
                )

        overlays = build_voiceover_overlays(
            speech.cues,
            session=session,
            block_id=saved_block_id or None,
            block_timeline_start_sec=element_timeline_start,
            alignment="sentence",
        )
        audio_clip = self._build_audio_clip(
            speech,
            asset_id=tts_asset_id,
            timeline_start_sec=element_timeline_start,
            block_id=saved_block_id or None,
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
            asset_id=tts_asset_id,
            block_id=saved_block_id,
            audio_clip_id=audio_clip.id,
            timeline_start_sec=element_timeline_start,
            overlay_ids=[item.id for item in overlays],
            preserve_video_block=preserved_video,
            trim_in_sec=trim_in_sec,
            trim_out_sec=trim_out_sec,
            library_asset_id=library_asset_id_for_meta,
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
                    VoiceoverSegmentStatus.BROLL_DONE,
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

    @staticmethod
    def _is_rerun_segment(segment: VoiceoverSegment) -> bool:
        return segment.status in (
            VoiceoverSegmentStatus.TTS_DONE,
            VoiceoverSegmentStatus.BROLL_DONE,
            VoiceoverSegmentStatus.FAILED,
        ) and bool(segment.tts.audio_clip_id or segment.tts.duration_sec)

    def _resolve_segment_timeline_start(
        self,
        session: EditSession,
        ordered: List[VoiceoverSegment],
        segment: VoiceoverSegment,
        *,
        is_rerun: bool = False,
    ) -> float:
        if is_rerun:
            return self._repack_voiceover_timeline_start(ordered, segment)

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
    def _repack_voiceover_timeline_start(
        ordered: List[VoiceoverSegment],
        segment: VoiceoverSegment,
    ) -> float:
        """Repack voiceover audio positions sequentially; do not anchor to stale video blocks."""
        anchor = 0.0
        if ordered:
            first = ordered[0]
            if first.tts.timeline_start_sec is not None and first.tts.timeline_start_sec >= 0:
                anchor = float(first.tts.timeline_start_sec)

        cursor = anchor
        for item in ordered:
            if item.id == segment.id:
                return cursor
            duration = float(item.tts.duration_sec or 0)
            if duration <= 0:
                continue
            if item.status in (
                VoiceoverSegmentStatus.SCRIPT_CONFIRMED,
                VoiceoverSegmentStatus.TTS_DONE,
                VoiceoverSegmentStatus.BROLL_DONE,
                VoiceoverSegmentStatus.FAILED,
            ):
                cursor += duration
        return cursor

    def _sync_voiceover_block_timeline(
        self,
        project_id: str,
        session_id: str,
        block_id: str,
        *,
        timeline_start_sec: float,
        duration_sec: float,
        trim_in_sec: float,
        trim_out_sec: float,
    ) -> EditSession:
        session = self.session_service.get_session(project_id, session_id)
        use_main_track = should_use_main_track_for_voiceover(session)
        updated_blocks: List[EditBlock] = []
        found = False
        for item in session.sequence or []:
            if item.id != block_id:
                updated_blocks.append(item)
                continue
            found = True
            data = item.model_dump()
            data["trim"] = EditBlockTrim(
                in_sec=trim_in_sec,
                out_sec=trim_out_sec,
            ).model_dump()
            data["duration_sec"] = float(duration_sec)
            if use_main_track:
                apply_main_track_placement_to_block_data(data)
            elif item.track_id == VOICEOVER_BROLL_TRACK_ID or item.timeline_start_sec is not None:
                apply_overlay_track_placement_to_block_data(data, timeline_start_sec)
            updated_blocks.append(EditBlock.model_validate(data))
        if not found:
            return session
        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_blocks),
        )

    @staticmethod
    def _resolve_insert_index(
        session: EditSession,
        plan: VoiceoverPlan,
        segment: VoiceoverSegment,
    ) -> Optional[int]:
        if should_use_main_track_for_voiceover(session):
            return resolve_main_track_insert_index(session, plan, segment)
        block_id = segment.broll.block_id
        if not block_id:
            return None
        for index, block in enumerate(session.sequence):
            if block.id == block_id:
                return index
        return None

    @staticmethod
    def _composition_end_sec(session: EditSession) -> float:
        transition = float(session.audio_settings.transition_duration_sec or 0.35)
        timeline = build_composition_timeline(session.sequence, transition)
        return float(timeline.total_duration_sec)

    def _cleanup_segment_artifacts(
        self,
        project_id: str,
        session_id: str,
        segment: VoiceoverSegment,
    ) -> EditSession:
        """Remove prior TTS audio clip, subtitle overlays, and unreferenced TTS assets."""
        session = self.session_service.get_session(project_id, session_id)
        overlay_ids = set(segment.subtitles.overlay_ids or [])
        clip_id = segment.tts.audio_clip_id
        old_asset_id = (segment.tts.asset_id or "").strip()

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

        session = self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(
                overlay_elements=overlays,
                audio_elements=clips,
            ),
        )

        if old_asset_id:
            session = self._remove_orphaned_audio_assets(
                project_id,
                session_id,
                session,
                {old_asset_id},
                exclude_segment_id=segment.id,
            )
        return session

    def _remove_orphaned_audio_assets(
        self,
        project_id: str,
        session_id: str,
        session: EditSession,
        asset_ids: set[str],
        *,
        exclude_segment_id: Optional[str] = None,
    ) -> EditSession:
        if not asset_ids:
            return session

        referenced: set[str] = set()
        for clip in session.audio_elements or []:
            aid = (clip.asset_id or "").strip()
            if aid:
                referenced.add(aid)

        plan = session.voiceover_plan
        if plan:
            for seg in plan.segments:
                if exclude_segment_id and seg.id == exclude_segment_id:
                    continue
                aid = (seg.tts.asset_id or "").strip()
                if aid:
                    referenced.add(aid)

        to_remove = {aid for aid in asset_ids if aid and aid not in referenced}
        if not to_remove:
            return session

        project_dir = get_project_directory(project_id)
        remaining_assets = []
        for asset in session.audio_assets or []:
            if asset.id in to_remove:
                if asset.path:
                    file_path = project_dir / asset.path
                    if file_path.exists():
                        try:
                            file_path.unlink()
                        except OSError:
                            logger.warning("无法删除口播 TTS 文件: %s", file_path)
                continue
            remaining_assets.append(asset)

        return self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(audio_assets=remaining_assets),
        )

    def _align_existing_block_to_audio(
        self,
        project_id: str,
        session_id: str,
        segment: VoiceoverSegment,
        audio_duration_sec: float,
    ) -> Tuple[EditSession, str, float, float]:
        block_id = (segment.broll.block_id or "").strip()
        if not block_id:
            return self.session_service.get_session(project_id, session_id), "", 0.0, 0.0

        session = self.session_service.get_session(project_id, session_id)
        block = next((item for item in session.sequence if item.id == block_id), None)
        if block is None:
            return session, "", 0.0, 0.0

        source_duration = self.session_service.probe_imported_block_duration(
            project_id,
            session_id,
            block_id,
        )
        if source_duration <= 0:
            raise ValueError("画面素材时长探测失败")

        if segment.broll.source_in_sec is not None:
            trim_in = float(segment.broll.source_in_sec)
        else:
            trim_in = float(block.trim.in_sec or 0.0)

        desired_out = trim_in + float(audio_duration_sec)
        if desired_out > source_duration + 0.05:
            available = max(0.0, source_duration - trim_in)
            raise ValueError(
                f"新口播 {audio_duration_sec:.2f}s 长于画面可用 {available:.2f}s，"
                "请缩短文案、重新应用 B-roll 或更换占位素材"
            )
        trim_out = min(desired_out, source_duration)
        timeline_duration = float(audio_duration_sec)

        updated_sequence: List[EditBlock] = []
        for item in session.sequence:
            if item.id != block_id:
                updated_sequence.append(item)
                continue
            data = item.model_dump()
            data["trim"] = EditBlockTrim(in_sec=trim_in, out_sec=trim_out).model_dump()
            data["duration_sec"] = timeline_duration
            updated_sequence.append(EditBlock.model_validate(data))

        session = self.session_service.update_session(
            project_id,
            session_id,
            EditSessionUpdateRequest(sequence=updated_sequence),
        )
        return session, block_id, trim_in, trim_out

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
        block_id: Optional[str] = None,
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
            block_offset_sec=0.0 if block_id else None,
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
        block_id: str = "",
        audio_clip_id: str,
        timeline_start_sec: float,
        overlay_ids: List[str],
        preserve_video_block: bool = False,
        trim_in_sec: float = 0.0,
        trim_out_sec: float = 0.0,
        library_asset_id: str = "",
    ) -> VoiceoverSegment:
        had_broll = segment.broll.selected is not None or segment.status == VoiceoverSegmentStatus.BROLL_DONE
        segment.status = (
            VoiceoverSegmentStatus.BROLL_DONE
            if preserve_video_block and had_broll
            else VoiceoverSegmentStatus.TTS_DONE
        )
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
        if preserve_video_block:
            segment.broll.source_in_sec = trim_in_sec
            segment.broll.source_out_sec = trim_out_sec
        else:
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

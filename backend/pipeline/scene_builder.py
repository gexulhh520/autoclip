"""EditSession → 合成场景图（Preview / Export 共用契约）。

与 frontend/src/editor/scene/ 保持语义对齐，供 FFmpeg 导出与后端测试使用。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional, Tuple

from backend.pipeline.edit_renderer import target_dimensions
from backend.schemas.edit_session import EditBlock, EditOverlayElement, EditSession

TransitionKind = Literal[
    "cut",
    "dissolve",
    "fade_black",
    "wipe_left",
    "wipe_right",
    "wipe_up",
    "wipe_down",
    "slide_left",
    "slide_right",
    "zoom",
]


def _is_cross_transition(kind: str) -> bool:
    return kind != "cut"


def _block_source_trim_duration(block: EditBlock) -> float:
    trimmed = block.trim.out_sec - block.trim.in_sec
    if trimmed > 0:
        return trimmed
    return block.duration_sec if block.duration_sec > 0 else 5.0


def _block_playback_rate(block: EditBlock) -> float:
    rate = float(block.playback_rate or 1.0)
    return max(0.25, min(4.0, rate))


def _block_duration(block: EditBlock) -> float:
    return _block_source_trim_duration(block) / _block_playback_rate(block)


def _timeline_offset_to_source_sec(block: EditBlock, rel_timeline_sec: float) -> float:
    source_trim = _block_source_trim_duration(block)
    return max(0.0, min(source_trim, rel_timeline_sec * _block_playback_rate(block)))


def _compute_dissolve_duration(block_duration_sec: float, transition_duration_sec: float) -> float:
    return max(0.1, min(transition_duration_sec, block_duration_sec * 0.45))


@dataclass
class CompositionSegment:
    block: EditBlock
    index: int
    composition_start_sec: float
    source_duration_sec: float
    transition_out: TransitionKind
    dissolve_out_sec: float


@dataclass
class CompositionTimeline:
    segments: List[CompositionSegment]
    total_duration_sec: float
    transition_duration_sec: float


@dataclass
class SceneCanvas:
    width: int
    height: int
    aspect: str
    fit_mode: str
    visual_filter: str
    fps: int


@dataclass
class VideoLayer:
    block_id: str
    block_index: int
    relative_source_sec: float
    opacity: float
    volume: float
    z_index: int


@dataclass
class TemplateCaptionLayer:
    block_id: str
    opacity: float


@dataclass
class RenderScene:
    time_sec: float
    total_duration_sec: float
    canvas: SceneCanvas
    video_layers: List[VideoLayer] = field(default_factory=list)
    template_captions: List[TemplateCaptionLayer] = field(default_factory=list)
    in_dissolve: bool = False
    dissolve_progress: Optional[float] = None


@dataclass
class ExportScenePlan:
    session: EditSession
    timeline: CompositionTimeline
    canvas: SceneCanvas
    burn_subtitles: bool
    use_source_video: bool
    free_overlays: List[EditOverlayElement]


def build_composition_timeline(
    blocks: List[EditBlock],
    transition_duration_sec: float,
) -> CompositionTimeline:
    if not blocks:
        return CompositionTimeline([], 0.0, transition_duration_sec)

    segments: List[CompositionSegment] = []
    cursor = 0.0

    for index, block in enumerate(blocks):
        source_duration = _block_duration(block)
        has_next = index < len(blocks) - 1
        dissolve_out = (
            _compute_dissolve_duration(source_duration, transition_duration_sec)
            if has_next and _is_cross_transition(block.transition_out)
            else 0.0
        )
        segments.append(
            CompositionSegment(
                block=block,
                index=index,
                composition_start_sec=cursor,
                source_duration_sec=source_duration,
                transition_out=block.transition_out,
                dissolve_out_sec=dissolve_out,
            )
        )
        cursor += source_duration - dissolve_out

    last = segments[-1]
    total = last.composition_start_sec + last.source_duration_sec
    return CompositionTimeline(segments, max(0.0, total), transition_duration_sec)


def _block_volume_at_relative(
    volume: float,
    relative_sec: float,
    duration_sec: float,
    fade_in_sec: float,
    fade_out_sec: float,
) -> float:
    gain = volume
    if fade_in_sec > 0 and relative_sec < fade_in_sec:
        gain *= relative_sec / fade_in_sec
    fade_out_start = max(0.0, duration_sec - fade_out_sec)
    if fade_out_sec > 0 and relative_sec > fade_out_start:
        gain *= max(0.0, (duration_sec - relative_sec) / fade_out_sec)
    return max(0.0, min(1.0, gain))


def build_canvas(session: EditSession) -> SceneCanvas:
    settings = session.export_settings
    width, height = target_dimensions(settings)
    return SceneCanvas(
        width=width,
        height=height,
        aspect=settings.aspect,
        fit_mode=settings.fit_mode,
        visual_filter=settings.visual_filter or "none",
        fps=settings.fps or 30,
    )


def compile_export_plan(
    session: EditSession,
    *,
    burn_subtitles: bool = True,
    use_source_video: bool = False,
) -> ExportScenePlan:
    transition_duration_sec = float(session.audio_settings.transition_duration_sec or 0.35)
    timeline = build_composition_timeline(session.sequence, transition_duration_sec)
    free_overlays = [
        item
        for item in (session.overlay_elements or [])
        if not item.hidden and str((item.params or {}).get("content", "") or "").strip()
    ]
    return ExportScenePlan(
        session=session,
        timeline=timeline,
        canvas=build_canvas(session),
        burn_subtitles=burn_subtitles,
        use_source_video=use_source_video,
        free_overlays=free_overlays,
    )


def serialize_export_plan(plan: ExportScenePlan) -> dict:
    """JSON 可序列化的 export plan（Headless / HTTP 批量出片）。"""
    return {
        "schema_version": "export-scene-1",
        "burn_subtitles": plan.burn_subtitles,
        "use_source_video": plan.use_source_video,
        "canvas": {
            "width": plan.canvas.width,
            "height": plan.canvas.height,
            "aspect": plan.canvas.aspect,
            "fit_mode": plan.canvas.fit_mode,
            "visual_filter": plan.canvas.visual_filter,
            "fps": plan.canvas.fps,
        },
        "timeline": {
            "total_duration_sec": plan.timeline.total_duration_sec,
            "transition_duration_sec": plan.timeline.transition_duration_sec,
            "segment_count": len(plan.timeline.segments),
        },
        "session_id": plan.session.id,
        "project_id": plan.session.project_id,
        "free_overlay_count": len(plan.free_overlays),
    }


def _find_dissolve(
    timeline: CompositionTimeline,
    time_sec: float,
) -> Optional[Tuple[CompositionSegment, CompositionSegment, float]]:
    segments = timeline.segments
    if len(segments) < 2:
        return None

    for index in range(len(segments) - 1):
        outgoing = segments[index]
        incoming = segments[index + 1]
        if outgoing.dissolve_out_sec <= 0:
            continue

        dissolve_start = (
            outgoing.composition_start_sec + outgoing.source_duration_sec - outgoing.dissolve_out_sec
        )
        dissolve_end = outgoing.composition_start_sec + outgoing.source_duration_sec

        if time_sec < dissolve_start - 0.001 or time_sec > dissolve_end + 0.001:
            continue

        progress = min(1.0, max(0.0, (time_sec - dissolve_start) / outgoing.dissolve_out_sec))
        return outgoing, incoming, progress

    return None


def resolve_scene_at(
    session: EditSession,
    time_sec: float,
    *,
    burn_subtitles: bool = True,
) -> RenderScene:
    transition_duration_sec = float(session.audio_settings.transition_duration_sec or 0.35)
    timeline = build_composition_timeline(session.sequence, transition_duration_sec)
    canvas = build_canvas(session)
    clamped = max(0.0, min(timeline.total_duration_sec, time_sec))

    dissolve = _find_dissolve(timeline, clamped)
    video_layers: List[VideoLayer] = []
    template_captions: List[TemplateCaptionLayer] = []

    if dissolve:
        outgoing, incoming, progress = dissolve
        out_relative = _timeline_offset_to_source_sec(
            outgoing.block, clamped - outgoing.composition_start_sec
        )
        in_relative = _timeline_offset_to_source_sec(
            incoming.block, clamped - incoming.composition_start_sec
        )
        out_source_trim = _block_source_trim_duration(outgoing.block)
        in_source_trim = _block_source_trim_duration(incoming.block)

        video_layers.extend(
            [
                VideoLayer(
                    block_id=outgoing.block.id,
                    block_index=outgoing.index,
                    relative_source_sec=out_relative,
                    opacity=1.0 - progress,
                    volume=_block_volume_at_relative(
                        outgoing.block.audio.volume,
                        out_relative,
                        out_source_trim,
                        outgoing.block.audio.fade_in_sec or 0.0,
                        outgoing.block.audio.fade_out_sec or 0.0,
                    ),
                    z_index=0,
                ),
                VideoLayer(
                    block_id=incoming.block.id,
                    block_index=incoming.index,
                    relative_source_sec=in_relative,
                    opacity=progress,
                    volume=_block_volume_at_relative(
                        incoming.block.audio.volume,
                        in_relative,
                        in_source_trim,
                        incoming.block.audio.fade_in_sec or 0.0,
                        incoming.block.audio.fade_out_sec or 0.0,
                    ),
                    z_index=1,
                ),
            ]
        )

        if burn_subtitles:
            template_captions.extend(
                [
                    TemplateCaptionLayer(block_id=outgoing.block.id, opacity=1.0 - progress),
                    TemplateCaptionLayer(block_id=incoming.block.id, opacity=progress),
                ]
            )
    else:
        active = next(
            (
                segment
                for segment in timeline.segments
                if clamped >= segment.composition_start_sec - 0.001
                and clamped < segment.composition_start_sec + segment.source_duration_sec + 0.001
            ),
            None,
        )
        if active:
            rel_timeline = clamped - active.composition_start_sec
            relative = _timeline_offset_to_source_sec(active.block, rel_timeline)
            source_trim = _block_source_trim_duration(active.block)
            video_layers.append(
                VideoLayer(
                    block_id=active.block.id,
                    block_index=active.index,
                    relative_source_sec=relative,
                    opacity=1.0,
                    volume=_block_volume_at_relative(
                        active.block.audio.volume,
                        relative,
                        source_trim,
                        active.block.audio.fade_in_sec or 0.0,
                        active.block.audio.fade_out_sec or 0.0,
                    ),
                    z_index=0,
                )
            )
            if burn_subtitles:
                template_captions.append(
                    TemplateCaptionLayer(block_id=active.block.id, opacity=1.0)
                )

    return RenderScene(
        time_sec=clamped,
        total_duration_sec=timeline.total_duration_sec,
        canvas=canvas,
        video_layers=video_layers,
        template_captions=template_captions,
        in_dissolve=dissolve is not None,
        dissolve_progress=dissolve[2] if dissolve else None,
    )

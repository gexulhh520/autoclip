"""剪辑工程导出：trim → overlay → 转场 → BGM → concat / SRT。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.core.path_utils import get_project_directory
from backend.pipeline.overlay_pipeline import resolve_overlay_pipeline
from backend.pipeline.composition import (
    build_frame_ffmpeg_filter,
    normalize_fit_mode,
    resolve_canvas_size,
    should_apply_canvas_in_final_pass,
    should_apply_canvas_per_segment,
)
from backend.schemas.edit_session import EditBlock, EditOverlayElement, EditSession
from backend.utils.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path
from backend.utils.video_processor import VideoProcessor

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int, str], None]

VISUAL_FILTER_PRESETS: Dict[str, Optional[str]] = {
    "none": None,
    "mono_soft": "eq=brightness=0.02:saturation=0.65:contrast=1.05",
    "mono_contrast": "eq=contrast=1.18:brightness=-0.03:saturation=0.55",
    "mono_cool": "eq=saturation=0.5:brightness=0.01,curves=b='0/0.05 0.5/0.48 1/0.95'",
    "mono_warm": "eq=saturation=0.62:brightness=0.03:contrast=1.06",
}


def build_frame_filter(settings, fit_mode: Optional[str] = None) -> Optional[str]:
    if hasattr(settings, "model_copy"):
        export_settings = settings
        if fit_mode:
            export_settings = settings.model_copy(update={"fit_mode": fit_mode})
        return build_frame_ffmpeg_filter(normalize_fit_mode(export_settings))
    return build_frame_ffmpeg_filter(settings)


def target_dimensions(
    settings,
    source_width: Optional[int] = None,
    source_height: Optional[int] = None,
) -> Tuple[int, int]:
    export_settings = normalize_fit_mode(settings) if hasattr(settings, "aspect") else settings
    canvas = resolve_canvas_size(export_settings, source_width, source_height)
    return canvas.width, canvas.height


def build_final_video_filter(
    session: EditSession,
    *,
    frame_already_applied: bool = False,
) -> Optional[str]:
    settings = session.export_settings
    frame = None
    if not frame_already_applied:
        frame = build_frame_filter(settings)
    elif should_apply_canvas_in_final_pass(settings):
        frame = build_frame_filter(settings)
    visual = VISUAL_FILTER_PRESETS.get(settings.visual_filter or "none")
    if not frame and not visual:
        return None
    if settings.fit_mode == "contain_blur" and frame:
        base = frame or ""
        if visual:
            return f"{base}[base];[base]{visual}[vout]"
        return f"{base}[vout]"
    parts = [part for part in (frame, visual) if part]
    return ",".join(parts) if parts else None


def block_to_clip_data(block: EditBlock) -> Dict[str, Any]:
    content = list(block.overlay.content or [])
    payload: Dict[str, Any] = {
        "outline": block.overlay.outline,
        "content": content,
        "recommend_reason": block.overlay.recommend_reason,
        "position_offset_x_pct": float(block.overlay.position_offset_x_pct or 0),
        "position_offset_y_pct": float(block.overlay.position_offset_y_pct or 0),
    }
    if len(content) >= 1 and all(isinstance(item, str) and item.strip() for item in content[:3]):
        payload["overlay_copy"] = True
    return payload


def _build_caption_style_config(
    overlay_config: Dict[str, Any],
    clip_data: Dict[str, Any],
    *,
    ref_width: int,
    ref_height: int,
) -> Dict[str, Any]:
    from backend.pipeline.overlay_pipeline import apply_overlay_position_offsets, build_overlay_layout_config

    layout_config = build_overlay_layout_config(
        overlay_config,
        ref_width=ref_width,
        ref_height=ref_height,
    )
    return apply_overlay_position_offsets(
        layout_config,
        clip_data,
        ref_width=ref_width,
        ref_height=ref_height,
    )


def _resolve_caption_overlay_dimensions(
    export_settings: Optional[Any],
    input_video: Path,
) -> Tuple[int, int, Optional[Tuple[int, int]], Optional[str]]:
    """返回 (ref_w, ref_h, canvas_size, frame_vf)。"""
    if export_settings is None:
        probed_w, probed_h = VideoProcessor._probe_video_dimensions(input_video)
        return probed_w, probed_h, None, None

    settings = normalize_fit_mode(export_settings)
    if settings.aspect == "original":
        probed_w, probed_h = VideoProcessor._probe_video_dimensions(input_video)
        return probed_w, probed_h, None, None

    canvas_size = target_dimensions(settings)
    frame_vf = build_frame_filter(export_settings)
    return canvas_size[0], canvas_size[1], canvas_size, frame_vf


def _block_playback_rate(block: EditBlock) -> float:
    rate = float(block.playback_rate or 1.0)
    return max(0.25, min(4.0, rate))


def _block_duration(block: EditBlock) -> float:
    duration = float(block.trim.out_sec - block.trim.in_sec)
    if duration > 0:
        return duration / _block_playback_rate(block)
    if block.duration_sec > 0:
        return float(block.duration_sec) / _block_playback_rate(block)
    return 0.0


def _build_speed_audio_filter(rate: float) -> Optional[str]:
    clamped = max(0.25, min(4.0, float(rate)))
    if abs(clamped - 1.0) < 0.01:
        return None
    parts: List[str] = []
    remaining = clamped
    while remaining > 2.0 + 0.001:
        parts.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5 - 0.001:
        parts.append("atempo=0.5")
        remaining /= 0.5
    if abs(remaining - 1.0) >= 0.01:
        parts.append(f"atempo={remaining:.4f}")
    return ",".join(parts) if parts else None


def _probe_duration(path: Path) -> float:
    info = VideoProcessor.get_video_info(path)
    return float(info.get("duration") or 0.0)


def _input_has_audio_stream(path: Path) -> bool:
    info = VideoProcessor.get_video_info(path)
    streams = info.get("streams") or []
    return any(stream.get("codec_type") == "audio" for stream in streams)


def _resolve_clip_render_window(
    project_dir: Path,
    block: EditBlock,
) -> Tuple[Path, float, float]:
    """从切片文件解析 trim 窗口（不读原片）。"""
    input_video = _resolve_input_video(project_dir, block)
    trim_in = max(0.0, float(block.trim.in_sec))
    trim_out = float(block.trim.out_sec)
    if trim_out <= trim_in:
        trim_out = trim_in + (_probe_duration(input_video) or block.duration_sec or 1.0)
    duration = max(0.1, trim_out - trim_in)
    return input_video, trim_in, duration


def _resolve_input_video(project_dir: Path, block: EditBlock) -> Path:
    if block.media.path:
        candidate = project_dir / block.media.path
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"找不到片段视频: {block.media.path}")


def _resolve_render_window(
    project_dir: Path,
    block: EditBlock,
    *,
    use_source_video: bool,
) -> Tuple[Path, float, float]:
    """返回 (输入视频, trim_in_sec, duration_sec)。"""
    trim_in = max(0.0, float(block.trim.in_sec))
    trim_out = float(block.trim.out_sec)

    if (
        use_source_video
        and block.media.source_video_path
        and block.media.source_start_sec is not None
    ):
        source = project_dir / block.media.source_video_path
        if source.exists():
            base = float(block.media.source_start_sec)
            if trim_out <= trim_in:
                source_end = block.media.source_end_sec
                if source_end is not None:
                    trim_out = float(source_end) - base
                else:
                    trim_out = _probe_duration(source) - base
            abs_in = base + trim_in
            duration = max(0.1, base + trim_out - abs_in)
            return source, abs_in, duration

    input_video = _resolve_input_video(project_dir, block)
    if trim_out <= trim_in:
        trim_out = trim_in + (_probe_duration(input_video) or block.duration_sec or 1.0)
    duration = max(0.1, trim_out - trim_in)
    return input_video, trim_in, duration


def _settings_from_session(session: EditSession) -> Dict[str, Any]:
    return {
        "template_id": session.template_id,
        "template_version": session.template_version,
        "overlay": session.overlay_snapshot or {},
        "template_rules": {
            "subtitle_style": "quote_cinema",
            "quote_overlay": (session.overlay_snapshot or {}).get("config") or {},
        },
    }


def _build_audio_filter(
    volume: float,
    *,
    fade_in_sec: float = 0.0,
    fade_out_sec: float = 0.0,
    duration_sec: float = 0.0,
) -> Optional[str]:
    vol = max(0.0, min(float(volume), 2.0))
    parts: List[str] = []
    if abs(vol - 1.0) >= 0.01:
        parts.append(f"volume={vol:.3f}")
    fade_in = max(0.0, float(fade_in_sec))
    fade_out = max(0.0, float(fade_out_sec))
    duration = max(0.0, float(duration_sec))
    if fade_in > 0:
        parts.append(f"afade=t=in:st=0:d={fade_in:.3f}")
    if fade_out > 0 and duration > fade_out:
        parts.append(f"afade=t=out:st={duration - fade_out:.3f}:d={fade_out:.3f}")
    if not parts:
        return None
    return ",".join(parts)


def render_block_segment(
    project_dir: Path,
    block: EditBlock,
    output_path: Path,
    *,
    burn_subtitles: bool,
    overlay_config: Optional[Dict[str, Any]] = None,
    use_source_video: bool = True,
    export_settings: Optional[Any] = None,
) -> bool:
    input_video, trim_in, duration = _resolve_render_window(
        project_dir, block, use_source_video=use_source_video
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg_bin = get_ffmpeg_path()

    clip_data = block_to_clip_data(block)
    ref_w, ref_h, canvas_size, frame_vf = _resolve_caption_overlay_dimensions(
        export_settings,
        input_video,
    )
    style_config = _build_caption_style_config(
        overlay_config or {},
        clip_data,
        ref_width=ref_w,
        ref_height=ref_h,
    )

    vf: Optional[str] = None
    if burn_subtitles:
        vf = VideoProcessor._build_cinema_subtitles_filter(
            clip_data,
            output_path,
            input_video,
            duration,
            style_config,
            canvas_width=ref_w,
            canvas_height=ref_h,
        )

    if frame_vf and vf:
        vf = f"{frame_vf},{vf}"
    elif frame_vf:
        vf = frame_vf

    af = _build_audio_filter(
        block.audio.volume,
        fade_in_sec=block.audio.fade_in_sec,
        fade_out_sec=block.audio.fade_out_sec,
        duration_sec=duration,
    )
    playback_rate = _block_playback_rate(block)
    if abs(playback_rate - 1.0) >= 0.01:
        speed_vf = f"setpts=PTS/{playback_rate:.6f}"
        vf = f"{vf},{speed_vf}" if vf else speed_vf
        speed_af = _build_speed_audio_filter(playback_rate)
        if speed_af:
            af = f"{af},{speed_af}" if af else speed_af
    filter_parts: List[str] = []
    if vf:
        filter_parts.append(vf)
    if af:
        filter_parts.append(af)

    cmd: List[str] = [
        ffmpeg_bin,
        "-ss",
        str(trim_in),
        "-i",
        str(input_video.resolve()),
        "-t",
        str(duration),
    ]
    if filter_parts:
        if vf and af:
            cmd.extend(["-vf", vf, "-af", af])
        elif vf:
            cmd.extend(["-vf", vf])
        else:
            cmd.extend(["-af", af])
    cmd.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-y",
            str(output_path.resolve()),
        ]
    )
    cwd = str(output_path.parent) if vf else None

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        cwd=cwd,
    )
    output_path.with_suffix(output_path.suffix + ".overlay.ass").unlink(missing_ok=True)

    if result.returncode != 0:
        logger.error("渲染片段失败: %s", result.stderr[:400])
        return False
    return output_path.exists()


def concat_segments(segment_paths: List[Path], output_path: Path) -> bool:
    if not segment_paths:
        return False
    if len(segment_paths) == 1:
        shutil.copy2(segment_paths[0], output_path)
        return output_path.exists()

    ffmpeg_bin = get_ffmpeg_path()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    list_file = output_path.parent / f"concat_{uuid.uuid4().hex[:8]}.txt"
    lines = [f"file '{path.resolve().as_posix()}'" for path in segment_paths]
    list_file.write_text("\n".join(lines), encoding="utf-8")

    def _run_concat(extra_video_args: List[str]) -> subprocess.CompletedProcess[str]:
        cmd = [
            ffmpeg_bin,
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            *extra_video_args,
            "-c:a",
            "aac",
            "-y",
            str(output_path),
        ]
        return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")

    result = _run_concat(["-c", "copy"])
    if result.returncode != 0:
        logger.warning("concat copy 失败，尝试重编码: %s", result.stderr[:200])
        result = _run_concat(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"])

    list_file.unlink(missing_ok=True)
    return result.returncode == 0 and output_path.exists()


def _is_cross_transition(transition: str) -> bool:
    return transition != "cut"


def _xfade_transition_name(transition: str) -> str:
    mapping = {
        "dissolve": "fade",
        "fade_black": "fadeblack",
        "wipe_left": "wiperight",
        "wipe_right": "wipeleft",
        "wipe_up": "wipeup",
        "wipe_down": "wipedown",
        "slide_left": "slideleft",
        "slide_right": "slideright",
        "zoom": "zoomin",
    }
    return mapping.get(transition, "fade")


def _merge_two_segments(
    path_a: Path,
    path_b: Path,
    *,
    transition: str,
    dissolve_duration: float,
    output_path: Path,
) -> bool:
    ffmpeg_bin = get_ffmpeg_path()
    duration_a = _probe_duration(path_a)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if transition == "cut":
        list_file = output_path.parent / f"pair_{uuid.uuid4().hex[:8]}.txt"
        list_file.write_text(
            "\n".join(
                [
                    f"file '{path_a.resolve().as_posix()}'",
                    f"file '{path_b.resolve().as_posix()}'",
                ]
            ),
            encoding="utf-8",
        )
        cmd = [
            ffmpeg_bin,
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            "-y",
            str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        if result.returncode != 0:
            cmd = [
                ffmpeg_bin,
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-y",
                str(output_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        list_file.unlink(missing_ok=True)
        return result.returncode == 0 and output_path.exists()

    dissolve = max(0.1, min(float(dissolve_duration), duration_a * 0.45))
    offset = max(0.0, duration_a - dissolve)
    xfade_name = _xfade_transition_name(transition)
    filter_complex = (
        f"[0:v][1:v]xfade=transition={xfade_name}:duration={dissolve}:offset={offset}[vout];"
        f"[0:a][1:a]acrossfade=d={dissolve}[aout]"
    )
    cmd = [
        ffmpeg_bin,
        "-i",
        str(path_a.resolve()),
        "-i",
        str(path_b.resolve()),
        "-filter_complex",
        filter_complex,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-y",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    return result.returncode == 0 and output_path.exists()


def concat_session_segments(
    session: EditSession,
    segment_paths: List[Path],
    output_path: Path,
) -> bool:
    if not segment_paths:
        return False
    if len(segment_paths) == 1:
        shutil.copy2(segment_paths[0], output_path)
        return output_path.exists()

    dissolve_duration = float(session.audio_settings.transition_duration_sec or 0.35)
    current = segment_paths[0]
    temp_dir = output_path.parent / "_xfade_tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    for index in range(1, len(segment_paths)):
        transition = session.sequence[index - 1].transition_out
        next_path = segment_paths[index]
        merged = temp_dir / f"merge_{index}.mp4"
        if not _merge_two_segments(
            current,
            next_path,
            transition=transition,
            dissolve_duration=dissolve_duration,
            output_path=merged,
        ):
            return False
        if current not in segment_paths:
            current.unlink(missing_ok=True)
        current = merged

    shutil.copy2(current, output_path)
    if current not in segment_paths:
        current.unlink(missing_ok=True)
    for leftover in temp_dir.glob("*.mp4"):
        leftover.unlink(missing_ok=True)
    temp_dir.rmdir()
    return output_path.exists()


def apply_final_video_pass(
    input_path: Path,
    output_path: Path,
    session: EditSession,
    *,
    frame_already_applied: bool = False,
) -> bool:
    vf = build_final_video_filter(session, frame_already_applied=frame_already_applied)
    if not vf:
        shutil.copy2(input_path, output_path)
        return output_path.exists()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    settings = session.export_settings
    width, out_height = target_dimensions(settings)
    use_filter_complex = settings.fit_mode == "contain_blur"

    cmd: List[str] = [get_ffmpeg_path(), "-i", str(input_path.resolve())]
    if use_filter_complex:
        mapped_vf = vf if vf.endswith("[vout]") else f"{vf}[vout]"
        cmd.extend(
            [
                "-filter_complex",
                mapped_vf,
                "-map",
                "[vout]",
                "-map",
                "0:a?",
            ]
        )
    else:
        cmd.extend(["-vf", vf, "-map", "0:v:0", "-map", "0:a?"])
    cmd.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
        ]
    )
    if settings.aspect != "original" and not frame_already_applied:
        cmd.extend(["-s", f"{width}x{out_height}"])
    cmd.extend(
        [
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-y",
            str(output_path.resolve()),
        ]
    )
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("最终画面处理失败: %s", result.stderr[:400])
        return False
    return output_path.exists()


FONT_SIZE_SCALE_REFERENCE = 90


def _overlay_scaled_font_size(font_size: int, canvas_height: int) -> int:
    return max(10, int(font_size * (canvas_height / FONT_SIZE_SCALE_REFERENCE)))


def _overlay_param(overlay: EditOverlayElement, key: str, default: Any = None) -> Any:
    params = overlay.params or {}
    return params.get(key, default)


def _build_free_overlay_drawtext(
    overlay: EditOverlayElement,
    temp_dir: Path,
    canvas_width: int,
    canvas_height: int,
    index: int,
    style_config: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    style_config = style_config or {}
    font_path = VideoProcessor._resolve_subtitle_font(style_config)
    if not font_path:
        return None

    content = str(_overlay_param(overlay, "content", "") or "").replace("\r\n", "\n")
    if not content.strip():
        return None

    text_file = temp_dir / f"free_overlay_{index}.txt"
    text_file.write_text(content, encoding="utf-8")

    font_size = _overlay_scaled_font_size(int(_overlay_param(overlay, "fontSize", 15) or 15), canvas_height)
    font_color = VideoProcessor._normalize_ffmpeg_color(str(_overlay_param(overlay, "color", "#ffffff")), "white")
    alpha = max(0.0, min(float(_overlay_param(overlay, "opacity", 1.0) or 1.0), 1.0))
    if alpha < 0.999:
        font_color = f"{font_color}@{alpha:.2f}"

    position_x = float(_overlay_param(overlay, "transform.positionX", 0.0) or 0.0)
    position_y = float(_overlay_param(overlay, "transform.positionY", 0.0) or 0.0)
    x_expr = f"(w/2)+{position_x:.2f}-text_w/2"
    y_expr = f"(h/2)+{position_y:.2f}-text_h/2"

    parts = [
        "drawtext="
        f"fontfile='{VideoProcessor._escape_filter_value(font_path.as_posix())}'"
        f":textfile='{VideoProcessor._escape_filter_value(text_file.as_posix())}'",
        f"fontsize={font_size}",
        f"fontcolor={font_color}",
        f"x={x_expr}",
        f"y={y_expr}",
        f"enable='between(t,{overlay.start_sec:.3f},{overlay.start_sec + overlay.duration_sec:.3f})'",
    ]

    if str(_overlay_param(overlay, "fontWeight", "normal")) == "bold":
        parts.append("borderw=2")
        parts.append(f"bordercolor={font_color}")

    if bool(_overlay_param(overlay, "background.enabled", False)):
        box_color = VideoProcessor._normalize_ffmpeg_color(
            str(_overlay_param(overlay, "background.color", "#000000")),
            "black@0.55",
        )
        pad = max(4, int(float(_overlay_param(overlay, "background.paddingY", 42) or 42) * (font_size / 15)))
        parts.extend(["box=1", f"boxcolor={box_color}", f"boxborderw={pad}"])

    line_height = float(_overlay_param(overlay, "lineHeight", 1.2) or 1.2)
    line_spacing = max(0, int((line_height - 1) * font_size))
    if line_spacing:
        parts.append(f"line_spacing={line_spacing}")

    return ":".join(parts)


def _overlay_track_id(overlay: EditOverlayElement) -> str:
    return overlay.track_id or "default-text"


def _sort_free_text_overlays(session: EditSession) -> List[EditOverlayElement]:
    overlays = [
        item
        for item in (session.overlay_elements or [])
        if not item.hidden and str(_overlay_param(item, "content", "") or "").strip()
    ]
    tracks = session.text_tracks or []
    hidden_ids = {track.id for track in tracks if track.hidden}
    overlays = [item for item in overlays if _overlay_track_id(item) not in hidden_ids]
    if not tracks:
        return overlays
    order_map = {track.id: track.order for track in tracks}
    return sorted(
        overlays,
        key=lambda item: (order_map.get(_overlay_track_id(item), 0), item.start_sec),
    )


def apply_free_text_overlays(
    input_path: Path,
    output_path: Path,
    session: EditSession,
) -> bool:
    overlays = _sort_free_text_overlays(session)
    if not overlays:
        shutil.copy2(input_path, output_path)
        return output_path.exists()

    width, height = target_dimensions(session.export_settings)
    temp_dir = output_path.parent / "_overlay_txt"
    temp_dir.mkdir(parents=True, exist_ok=True)

    filters: List[str] = []
    for index, overlay in enumerate(overlays):
        drawtext = _build_free_overlay_drawtext(
            overlay,
            temp_dir,
            width,
            height,
            index,
        )
        if drawtext:
            filters.append(drawtext)

    if not filters:
        shutil.copy2(input_path, output_path)
        return output_path.exists()

    vf = ",".join(filters)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        get_ffmpeg_path(),
        "-i",
        str(input_path.resolve()),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-c:a",
        "copy",
        "-y",
        str(output_path.resolve()),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("自由文本层导出失败: %s", result.stderr[:400])
        shutil.copy2(input_path, output_path)
        return output_path.exists()
    return output_path.exists()


def mix_bgm_track(
    video_path: Path,
    bgm_path: Path,
    output_path: Path,
    *,
    bgm_volume: float,
    fade_in_sec: float,
    fade_out_sec: float,
    duck_enabled: bool = False,
    duck_ratio: float = 8.0,
) -> bool:
    if not bgm_path.exists():
        return False
    duration = _probe_duration(video_path)
    fade_in = max(0.0, float(fade_in_sec))
    fade_out = max(0.0, float(fade_out_sec))
    fade_out_start = max(0.0, duration - fade_out)
    vol = max(0.0, min(float(bgm_volume), 2.0))
    ratio = max(2.0, min(float(duck_ratio), 20.0))
    has_video_audio = _input_has_audio_stream(video_path)
    bgm_chain = (
        f"[1:a]volume={vol},afade=t=in:st=0:d={fade_in},"
        f"afade=t=out:st={fade_out_start}:d={fade_out}[bgm]"
    )
    if has_video_audio:
        if duck_enabled:
            filter_complex = (
                f"{bgm_chain};"
                f"[bgm][0:a]sidechaincompress=threshold=0.02:ratio={ratio}:attack=8:release=250[bgm_duck];"
                f"[0:a][bgm_duck]amix=inputs=2:duration=first:dropout_transition=0[aout]"
            )
        else:
            filter_complex = f"{bgm_chain};[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    else:
        filter_complex = f"{bgm_chain};[bgm]anull[aout]"
    cmd = [
        get_ffmpeg_path(),
        "-i",
        str(video_path.resolve()),
        "-i",
        str(bgm_path.resolve()),
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-y",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("BGM 混音失败: %s", result.stderr[:300])
        return False
    return output_path.exists()


def _mux_video_with_audio(video_path: Path, audio_path: Path, output_path: Path) -> bool:
    cmd = [
        get_ffmpeg_path(),
        "-i",
        str(video_path.resolve()),
        "-i",
        str(audio_path.resolve()),
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-y",
        str(output_path.resolve()),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("视频与音频混流失败: %s", result.stderr[:300])
        return False
    return output_path.is_file()


def _amix_audio_files(inputs: List[Path], output_path: Path) -> bool:
    if not inputs:
        return False
    if len(inputs) == 1:
        shutil.copy2(inputs[0], output_path)
        return output_path.is_file()
    cmd: List[str] = [get_ffmpeg_path()]
    for path in inputs:
        cmd.extend(["-i", str(path.resolve())])
    mix_inputs = "".join(f"[{index}:a]" for index in range(len(inputs)))
    filter_complex = (
        f"{mix_inputs}amix=inputs={len(inputs)}:duration=longest:dropout_transition=0:normalize=0[aout]"
    )
    cmd.extend(
        [
            "-filter_complex",
            filter_complex,
            "-map",
            "[aout]",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-y",
            str(output_path.resolve()),
        ]
    )
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("多轨音频混合失败: %s", result.stderr[:300])
        return False
    return output_path.is_file()


def _render_timeline_audio_clips(
    session: EditSession,
    project_dir: Path,
    output_path: Path,
    *,
    total_duration: float,
) -> bool:
    """将 audio_elements 时间轴音频轨渲染为单条 AAC。"""
    clips = [clip for clip in (session.audio_elements or []) if not clip.hidden]
    if not clips:
        return False

    assets_by_id = {asset.id: asset for asset in (session.audio_assets or [])}
    defaults = session.audio_settings
    cmd: List[str] = [get_ffmpeg_path()]
    filter_parts: List[str] = []
    mix_labels: List[str] = []
    input_index = 0

    for clip_idx, clip in enumerate(clips):
        asset = assets_by_id.get(clip.asset_id)
        if asset is None:
            logger.warning("时间轴音频缺少 asset: %s", clip.asset_id)
            continue
        asset_path = project_dir / asset.path
        if not asset_path.is_file():
            logger.warning("时间轴音频文件不存在: %s", asset.path)
            continue

        trim_start = max(0.0, float(clip.trim_start_sec or 0.0))
        clip_duration = max(0.05, float(clip.duration_sec))
        trim_end = clip.trim_end_sec
        if trim_end is None:
            trim_end = trim_start + clip_duration
        else:
            trim_end = min(float(trim_end), trim_start + clip_duration)

        vol = defaults.bgm_volume if clip.volume is None else clip.volume
        fade_in = defaults.fade_in_sec if clip.fade_in_sec is None else clip.fade_in_sec
        fade_out = defaults.fade_out_sec if clip.fade_out_sec is None else clip.fade_out_sec
        fade_out_start = max(0.0, clip_duration - fade_out)
        delay_ms = int(round(max(0.0, clip.start_sec) * 1000))
        label = f"tclip{clip_idx}"

        af = _build_audio_filter(
            vol,
            fade_in_sec=fade_in,
            fade_out_sec=fade_out,
            duration_sec=clip_duration,
        )
        af_suffix = f",{af}" if af else ""
        filter_parts.append(
            f"[{input_index}:a]atrim=start={trim_start:.3f}:end={trim_end:.3f},"
            f"asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo"
            f"{af_suffix},adelay={delay_ms}|{delay_ms}[{label}]"
        )
        mix_labels.append(f"[{label}]")
        cmd.extend(["-i", str(asset_path.resolve())])
        input_index += 1

    if not mix_labels:
        return False

    if len(mix_labels) == 1:
        filter_parts.append(f"{mix_labels[0]}anull[aout]")
    else:
        filter_parts.append(
            "".join(mix_labels)
            + f"amix=inputs={len(mix_labels)}:duration=longest:dropout_transition=0:normalize=0[aout]"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd.extend(
        [
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            "[aout]",
            "-t",
            str(max(0.1, total_duration)),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-y",
            str(output_path.resolve()),
        ]
    )
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("时间轴 BGM 渲染失败: %s", result.stderr[:400])
        output_path.unlink(missing_ok=True)
        return False
    return output_path.is_file() and output_path.stat().st_size > 0


def _seconds_to_srt_timestamp(total_seconds: float) -> str:
    clamped = max(0.0, total_seconds)
    hours = int(clamped // 3600)
    minutes = int((clamped % 3600) // 60)
    secs = int(clamped % 60)
    millis = int(round((clamped - int(clamped)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_export_srt(session: EditSession, output_path: Path) -> Path:
    lines: List[str] = []
    cursor = 0.0
    dissolve = float(session.audio_settings.transition_duration_sec or 0.35)
    for index, block in enumerate(session.sequence, start=1):
        duration = _block_duration(block)
        if duration <= 0:
            continue
        text = (
            block.overlay.content[0]
            if block.overlay.content
            else block.overlay.outline or block.title
        )
        start = cursor
        end = cursor + duration
        lines.append(str(index))
        lines.append(f"{_seconds_to_srt_timestamp(start)} --> {_seconds_to_srt_timestamp(end)}")
        lines.append(str(text).strip())
        lines.append("")
        cursor = end
        if index < len(session.sequence) and _is_cross_transition(block.transition_out):
            cursor -= min(dissolve, duration * 0.45)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


def export_edit_session(
    session: EditSession,
    *,
    burn_subtitles: bool = True,
    output_filename: Optional[str] = None,
    export_srt: bool = False,
    use_source_video: Optional[bool] = None,
    progress_callback: Optional[Callable[[int, str], None]] = None,
) -> Tuple[Path, Optional[Path]]:
    """FFmpeg 合成导出（预览一致的字幕/画幅由 Compositor 路径负责；此为稳定兜底）。"""
    def report(progress: int, message: str) -> None:
        if progress_callback is not None:
            progress_callback(max(0, min(progress, 100)), message)

    session = session.model_copy(deep=True)
    session.export_settings = normalize_fit_mode(session.export_settings)

    project_dir = get_project_directory(session.project_id)
    export_dir = project_dir / "edit_exports" / session.id
    export_dir.mkdir(parents=True, exist_ok=True)

    settings = session.export_settings
    frame_per_segment = should_apply_canvas_per_segment(settings)

    pipeline = resolve_overlay_pipeline(_settings_from_session(session))
    overlay_config = pipeline.config
    prefer_source = (
        use_source_video
        if use_source_video is not None
        else bool(session.audio_settings.use_source_video)
    )

    total_blocks = max(len(session.sequence), 1)
    segment_paths: List[Path] = []
    for index, block in enumerate(session.sequence):
        report(int((index / total_blocks) * 70), f"渲染片段 {index + 1}/{total_blocks}")
        segment_path = export_dir / f"seg_{index:03d}_{block.id[:8]}.mp4"
        ok = render_block_segment(
            project_dir,
            block,
            segment_path,
            burn_subtitles=burn_subtitles and pipeline.composer != "none",
            overlay_config=overlay_config,
            use_source_video=prefer_source,
            export_settings=settings,
        )
        if not ok:
            raise RuntimeError(f"片段渲染失败: {block.title}")
        segment_paths.append(segment_path)

    safe_name = (output_filename or session.name or "export").strip()
    for char in '\\/:*?"<>|':
        safe_name = safe_name.replace(char, "_")
    merged_path = export_dir / f"{safe_name}_merged.mp4"
    output_path = export_dir / f"{safe_name}.mp4"

    report(75, "拼接序列")
    if not concat_session_segments(session, segment_paths, merged_path):
        raise RuntimeError("序列拼接失败")

    for seg in segment_paths:
        seg.unlink(missing_ok=True)

    report(82, "处理画幅与滤镜")
    framed_path = export_dir / f"{safe_name}_framed.mp4"
    if not apply_final_video_pass(
        merged_path,
        framed_path,
        session,
        frame_already_applied=frame_per_segment,
    ):
        if settings.aspect != "original" and not frame_per_segment:
            raise RuntimeError("画幅处理失败，请检查 FFmpeg 日志")
        shutil.copy2(merged_path, framed_path)
    merged_path.unlink(missing_ok=True)
    merged_path = framed_path

    overlay_path = export_dir / f"{safe_name}_overlay.mp4"
    report(86, "烧录自由文本层")
    if not apply_free_text_overlays(merged_path, overlay_path, session):
        raise RuntimeError("自由文本层处理失败")
    merged_path.unlink(missing_ok=True)
    merged_path = overlay_path

    bgm_path: Optional[Path] = None
    bgm_volume = session.audio_settings.bgm_volume
    fade_in = session.audio_settings.fade_in_sec
    fade_out = session.audio_settings.fade_out_sec
    bgm_rel = session.audio_settings.bgm_path
    if bgm_rel:
        bgm_path = project_dir / bgm_rel
    elif session.audio_elements and session.audio_assets:
        clip = session.audio_elements[0]
        asset = next((item for item in session.audio_assets if item.id == clip.asset_id), None)
        if asset:
            bgm_path = project_dir / asset.path
            bgm_volume = clip.volume if clip.volume is not None else bgm_volume
            fade_in = clip.fade_in_sec if clip.fade_in_sec is not None else fade_in
            fade_out = clip.fade_out_sec if clip.fade_out_sec is not None else fade_out
    if bgm_path and bgm_path.exists():
        report(92, "混音 BGM")
        if not mix_bgm_track(
            merged_path,
            bgm_path,
            output_path,
            bgm_volume=bgm_volume,
            fade_in_sec=fade_in,
            fade_out_sec=fade_out,
            duck_enabled=session.audio_settings.bgm_duck_enabled,
            duck_ratio=session.audio_settings.bgm_duck_ratio,
        ):
            shutil.copy2(merged_path, output_path)
    else:
        shutil.copy2(merged_path, output_path)
    merged_path.unlink(missing_ok=True)

    srt_path: Optional[Path] = None
    if export_srt:
        report(97, "生成 SRT")
        srt_path = write_export_srt(session, export_dir / f"{safe_name}.srt")

    report(100, "导出完成")
    return output_path, srt_path


def _safe_export_stem(value: str, fallback: str) -> str:
    stem = (value or fallback).strip()
    for char in '\\/:*?"<>|':
        stem = stem.replace(char, "_")
    return stem or fallback


def _extract_audio_from_window(
    input_video: Path,
    trim_in: float,
    duration: float,
    block: EditBlock,
    output_path: Path,
) -> bool:
    if not _input_has_audio_stream(input_video):
        logger.warning("输入视频无音频轨: %s", input_video)
        return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    af = _build_audio_filter(
        block.audio.volume,
        fade_in_sec=block.audio.fade_in_sec,
        fade_out_sec=block.audio.fade_out_sec,
        duration_sec=duration,
    )
    playback_rate = _block_playback_rate(block)
    if abs(playback_rate - 1.0) >= 0.01:
        speed_af = _build_speed_audio_filter(playback_rate)
        if speed_af:
            af = f"{af},{speed_af}" if af else speed_af
    cmd: List[str] = [
        get_ffmpeg_path(),
        "-ss",
        str(trim_in),
        "-i",
        str(input_video.resolve()),
        "-t",
        str(duration),
        "-vn",
        "-map",
        "0:a:0",
    ]
    if af:
        cmd.extend(["-af", af])
    cmd.extend(["-c:a", "aac", "-b:a", "128k", "-y", str(output_path.resolve())])
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.error("片段音频提取失败 (%s): %s", input_video.name, result.stderr[:300])
        output_path.unlink(missing_ok=True)
        return False
    return output_path.is_file() and output_path.stat().st_size > 0


def extract_block_audio_segment(
    project_dir: Path,
    block: EditBlock,
    output_path: Path,
    *,
    use_source_video: bool,
) -> bool:
    """提取单片段音频轨（无视频滤镜）— Compositor 导出后混音用。"""
    candidates: List[Tuple[Path, float, float]] = []
    try:
        candidates.append(
            _resolve_render_window(project_dir, block, use_source_video=use_source_video)
        )
    except FileNotFoundError:
        pass

    if use_source_video:
        try:
            clip_window = _resolve_clip_render_window(project_dir, block)
            if all(clip_window[0].resolve() != existing[0].resolve() for existing in candidates):
                candidates.append(clip_window)
        except FileNotFoundError:
            pass
    elif not candidates:
        return False

    for input_video, trim_in, duration in candidates:
        if _extract_audio_from_window(input_video, trim_in, duration, block, output_path):
            if (
                use_source_video
                and len(candidates) > 1
                and input_video.resolve() != candidates[0][0].resolve()
            ):
                logger.warning("原片音频提取失败，已回退至切片: %s", block.id)
            return True

    return False


@dataclass(frozen=True)
class CompositorMuxResult:
    output_path: Path
    srt_path: Optional[Path]
    audio_mixed: bool
    audio_warning: Optional[str] = None


def mux_compositor_export(
    session: EditSession,
    compositor_video: Path,
    *,
    output_filename: Optional[str] = None,
    export_srt: bool = False,
    use_source_video: Optional[bool] = None,
    block_id: Optional[str] = None,
) -> CompositorMuxResult:
    """Compositor 像素 + timeline 音频/BGM → 成片（无 ASS/drawtext 布局）。

    ``block_id`` 仅混流单片段音频（批量分轨 Compositor 导出）。
    """
    if not compositor_video.is_file():
        raise FileNotFoundError(str(compositor_video))

    session = session.model_copy(deep=True)
    project_dir = get_project_directory(session.project_id)
    export_dir = project_dir / "edit_exports" / session.id
    export_dir.mkdir(parents=True, exist_ok=True)

    prefer_source = (
        use_source_video
        if use_source_video is not None
        else bool(session.audio_settings.use_source_video)
    )

    safe_name = _safe_export_stem(output_filename or session.name, session.id[:8])
    output_path = export_dir / f"{safe_name}.mp4"
    audio_segments: List[Path] = []
    blocks_for_audio = [
        block
        for block in session.sequence
        if block_id is None or block.id == block_id
    ]

    for index, block in enumerate(session.sequence):
        if block_id is not None and block.id != block_id:
            continue
        seg_audio = export_dir / f"compositor_audio_{index:03d}.aac"
        if extract_block_audio_segment(
            project_dir, block, seg_audio, use_source_video=prefer_source
        ):
            audio_segments.append(seg_audio)

    audio_mixed = False
    audio_warning: Optional[str] = None
    failed_count = len(blocks_for_audio) - len(audio_segments)
    video_duration = _probe_duration(compositor_video)

    block_timeline_audio = export_dir / f"{safe_name}_block_timeline.aac"
    has_block_audio = False
    if audio_segments:
        concat_list = export_dir / f"{safe_name}_audio_concat.txt"
        concat_lines = [f"file '{path.resolve().as_posix()}'" for path in audio_segments]
        concat_list.write_text("\n".join(concat_lines), encoding="utf-8")
        concat_cmd = [
            get_ffmpeg_path(),
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list.resolve()),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-y",
            str(block_timeline_audio.resolve()),
        ]
        result = subprocess.run(
            concat_cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )
        concat_list.unlink(missing_ok=True)
        for seg in audio_segments:
            seg.unlink(missing_ok=True)
        if result.returncode != 0 or not block_timeline_audio.exists():
            raise RuntimeError(f"时间轴音频拼接失败: {result.stderr[:300]}")
        has_block_audio = True

    timeline_clips_audio = export_dir / f"{safe_name}_timeline_clips.aac"
    has_timeline_clips = _render_timeline_audio_clips(
        session,
        project_dir,
        timeline_clips_audio,
        total_duration=video_duration,
    )

    audio_parts: List[Path] = []
    if has_block_audio:
        audio_parts.append(block_timeline_audio)
    if has_timeline_clips:
        audio_parts.append(timeline_clips_audio)

    merged_audio = export_dir / f"{safe_name}_timeline_audio.aac"
    if audio_parts:
        if not _amix_audio_files(audio_parts, merged_audio):
            raise RuntimeError("时间轴音频混合失败")
        for part in audio_parts:
            part.unlink(missing_ok=True)

        staged = export_dir / f"{safe_name}_with_audio.mp4"
        if not _mux_video_with_audio(compositor_video, merged_audio, staged):
            raise RuntimeError("视频与音频混流失败")
        merged_audio.unlink(missing_ok=True)
        shutil.copy2(staged, output_path)
        staged.unlink(missing_ok=True)
        audio_mixed = _input_has_audio_stream(output_path)
        if failed_count > 0:
            if has_timeline_clips:
                audio_warning = (
                    f"有 {failed_count} 个视频片段未能提取原声，"
                    "成片已混入时间轴 BGM/音频轨。"
                )
            else:
                audio_warning = f"有 {failed_count} 个片段未能提取音频，成片可能不完整。"
    else:
        shutil.copy2(compositor_video, output_path)
        if blocks_for_audio:
            if session.audio_elements:
                audio_warning = (
                    "未能从视频片段提取原声，且时间轴 BGM/音频轨渲染失败。"
                    "请确认音频文件仍在工程目录中。"
                )
            else:
                audio_warning = (
                    "未能从时间轴片段提取任何音频。"
                    "请确认切片/原片文件存在且含音轨，或取消「使用原片重切」后重试。"
                )
        else:
            audio_warning = "时间轴无片段，导出为无声视频。"

    bgm_rel = session.audio_settings.bgm_path
    if bgm_rel and not session.audio_elements:
        bgm_path = project_dir / bgm_rel
        if bgm_path.exists():
            final_with_bgm = export_dir / f"{safe_name}_final.mp4"
            if mix_bgm_track(
                output_path,
                bgm_path,
                final_with_bgm,
                bgm_volume=session.audio_settings.bgm_volume,
                fade_in_sec=session.audio_settings.fade_in_sec,
                fade_out_sec=session.audio_settings.fade_out_sec,
                duck_enabled=session.audio_settings.bgm_duck_enabled,
                duck_ratio=session.audio_settings.bgm_duck_ratio,
            ):
                output_path.unlink(missing_ok=True)
                shutil.move(str(final_with_bgm), str(output_path))
                audio_mixed = _input_has_audio_stream(output_path)

    srt_path: Optional[Path] = None
    if export_srt:
        srt_session = session
        if block_id is not None:
            srt_session = session.model_copy(deep=True)
            srt_session.sequence = [b for b in session.sequence if b.id == block_id]
        srt_path = write_export_srt(srt_session, export_dir / f"{safe_name}.srt")

    if not audio_mixed and audio_warning is None:
        audio_warning = "导出文件未检测到音频轨。"

    return CompositorMuxResult(
        output_path=output_path,
        srt_path=srt_path,
        audio_mixed=audio_mixed,
        audio_warning=audio_warning,
    )


def export_single_block(
    session: EditSession,
    block: EditBlock,
    *,
    burn_subtitles: bool = True,
    output_filename: Optional[str] = None,
    export_srt: bool = False,
    use_source_video: Optional[bool] = None,
) -> Tuple[Path, Optional[Path]]:
    single = session.model_copy(deep=True)
    single.sequence = [block]
    stem = _safe_export_stem(output_filename or block.title, block.id[:8])
    return export_edit_session(
        single,
        burn_subtitles=burn_subtitles,
        output_filename=stem,
        export_srt=export_srt,
        use_source_video=use_source_video,
    )


def batch_export_edit_session(
    session: EditSession,
    *,
    burn_subtitles: bool = True,
    export_srt: bool = False,
    use_source_video: Optional[bool] = None,
    progress_callback: Optional[ProgressCallback] = None,
) -> List[Tuple[EditBlock, Path, Optional[Path]]]:
    results: List[Tuple[EditBlock, Path, Optional[Path]]] = []
    total = len(session.sequence)

    def report(progress: int, message: str) -> None:
        if progress_callback is not None:
            progress_callback(progress, message)

    for index, block in enumerate(session.sequence, start=1):
        pct = int(((index - 1) / max(total, 1)) * 95)
        report(pct, f"导出片段 {index}/{total}: {block.title[:24]}")
        stem = _safe_export_stem(block.title, f"block_{index:02d}")
        video_path, srt_path = export_single_block(
            session,
            block,
            burn_subtitles=burn_subtitles,
            output_filename=stem,
            export_srt=export_srt,
            use_source_video=use_source_video,
        )
        results.append((block, video_path, srt_path))
    report(100, "批量导出完成")
    return results


def _parse_silencedetect_output(stderr: str) -> List[Tuple[float, float]]:
    regions: List[Tuple[float, float]] = []
    pending_start: Optional[float] = None
    for line in stderr.splitlines():
        if "silence_start:" in line:
            try:
                pending_start = float(line.split("silence_start:")[-1].strip().split()[0])
            except ValueError:
                pending_start = None
        elif "silence_end:" in line and pending_start is not None:
            try:
                end = float(line.split("silence_end:")[-1].strip().split()[0])
                regions.append((pending_start, end))
            except ValueError:
                pass
            pending_start = None
    return regions


def suggest_internal_split_points(
    silence_regions: List[Tuple[float, float]],
    window_duration: float,
    trim_in_abs: float,
    *,
    edge_margin: float = 0.25,
) -> List[float]:
    if window_duration <= 0 or not silence_regions:
        return []

    splits: List[float] = []
    for start, end in sorted(silence_regions, key=lambda item: item[0]):
        if start <= 0.01 or end >= window_duration - 0.01:
            continue
        mid = (start + end) / 2.0
        if mid < edge_margin or mid > window_duration - edge_margin:
            continue
        splits.append(trim_in_abs + mid)

    if not splits:
        return []

    deduped: List[float] = [splits[0]]
    for point in splits[1:]:
        if point - deduped[-1] >= 0.35:
            deduped.append(point)
    return deduped


def suggest_speech_trim(
    silence_regions: List[Tuple[float, float]],
    window_duration: float,
    *,
    pad_sec: float = 0.05,
) -> Tuple[float, float]:
    if window_duration <= 0:
        return 0.0, 0.0
    if not silence_regions:
        return 0.0, window_duration

    sorted_regions = sorted(silence_regions, key=lambda item: item[0])
    in_sec = 0.0
    out_sec = window_duration

    first_start, first_end = sorted_regions[0]
    if first_start <= 0.01:
        in_sec = first_end

    last_start, last_end = sorted_regions[-1]
    if last_end >= window_duration - 0.01:
        out_sec = last_start

    in_sec = max(0.0, in_sec - pad_sec)
    out_sec = min(window_duration, out_sec + pad_sec)
    if out_sec <= in_sec + 0.1:
        return 0.0, window_duration
    return in_sec, out_sec


def detect_block_silence(
    project_dir: Path,
    block: EditBlock,
    *,
    noise_db: float = -35.0,
    min_silence_sec: float = 0.35,
) -> Dict[str, Any]:
    input_video = _resolve_input_video(project_dir, block)
    trim_in = max(0.0, float(block.trim.in_sec))
    trim_out = float(block.trim.out_sec)
    if trim_out <= trim_in:
        trim_out = trim_in + (_probe_duration(input_video) or block.duration_sec or 1.0)
    window_duration = max(0.1, trim_out - trim_in)

    cmd = [
        get_ffmpeg_path(),
        "-ss",
        str(trim_in),
        "-i",
        str(input_video.resolve()),
        "-t",
        str(window_duration),
        "-af",
        f"silencedetect=noise={noise_db}dB:d={min_silence_sec}",
        "-f",
        "null",
        "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        logger.warning("静音检测失败: %s", result.stderr[:300])

    relative_regions = _parse_silencedetect_output(result.stderr)
    rel_in, rel_out = suggest_speech_trim(relative_regions, window_duration)
    suggested_in = trim_in + rel_in
    suggested_out = trim_in + rel_out
    removed = max(0.0, window_duration - (rel_out - rel_in))

    split_points = suggest_internal_split_points(
        relative_regions,
        window_duration,
        trim_in,
    )

    return {
        "silence_regions": [
            {"start_sec": trim_in + start, "end_sec": trim_in + end}
            for start, end in relative_regions
        ],
        "suggested_trim": {"in_sec": suggested_in, "out_sec": suggested_out},
        "removed_sec": removed,
        "split_points": split_points,
    }


def preview_block_overlay(session: EditSession, block_id: str) -> Dict[str, Any]:
    from backend.pipeline.overlay_pipeline import build_overlay_preview

    block = next((item for item in session.sequence if item.id == block_id), None)
    if block is None:
        raise ValueError("片段不存在")
    pipeline = resolve_overlay_pipeline(_settings_from_session(session))
    canvas = resolve_canvas_size(session.export_settings)
    return build_overlay_preview(
        block_to_clip_data(block),
        pipeline,
        ref_width=canvas.width,
        ref_height=canvas.height,
    )

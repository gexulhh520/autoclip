"""剪辑工程导出：trim → overlay → 转场 → BGM → concat / SRT。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.core.path_utils import get_project_directory
from backend.pipeline.overlay_pipeline import resolve_overlay_pipeline
from backend.schemas.edit_session import EditBlock, EditSession
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


ASPECT_RATIOS = {
    "16:9": (16, 9),
    "4:3": (4, 3),
    "2.35:1": (47, 20),
    "2:1": (2, 1),
    "1.85:1": (37, 20),
    "9:16": (9, 16),
    "3:4": (3, 4),
    "5.8": (9, 195),  # 5.8 寸竖屏约 9:19.5
    "1:1": (1, 1),
    "1:2": (1, 2),
}


def _ensure_even(value: int) -> int:
    size = max(2, int(value))
    if size % 2:
        size += 1
    return size


def target_dimensions(
    settings,
    source_width: Optional[int] = None,
    source_height: Optional[int] = None,
) -> Tuple[int, int]:
    aspect = getattr(settings, "aspect", settings) if not isinstance(settings, str) else settings
    height = getattr(settings, "height", 1080) if not isinstance(settings, str) else 1080

    if isinstance(settings, str):
        aspect = settings

    if aspect == "original":
        if source_width and source_height:
            return _ensure_even(source_width), _ensure_even(source_height)
        return 1920, 1080

    if aspect == "custom":
        custom_width = getattr(settings, "custom_width", None) if not isinstance(settings, str) else None
        custom_height = getattr(settings, "custom_height", None) if not isinstance(settings, str) else None
        return _ensure_even(custom_width or 1080), _ensure_even(custom_height or 1920)

    rw, rh = ASPECT_RATIOS.get(aspect, (9, 16))
    out_h = _ensure_even(height)
    out_w = _ensure_even(int(out_h * rw / rh))
    return out_w, out_h


def build_frame_filter(settings, fit_mode: Optional[str] = None) -> Optional[str]:
    aspect = settings.aspect if hasattr(settings, "aspect") else settings
    if isinstance(settings, str):
        aspect = settings
    if aspect == "original":
        return None

    mode = fit_mode or getattr(settings, "fit_mode", "contain")
    width, out_height = target_dimensions(settings)
    if mode == "contain_blur":
        return (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{out_height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{out_height},boxblur=20:10[blurred];"
            f"[fg]scale={width}:{out_height}:force_original_aspect_ratio=decrease[scaled];"
            f"[blurred][scaled]overlay=(W-w)/2:(H-h)/2"
        )
    if mode == "cover":
        return (
            f"scale={width}:{out_height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{out_height}"
        )
    return (
        f"scale={width}:{out_height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{out_height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    )


def should_apply_canvas_per_segment(settings) -> bool:
    aspect = getattr(settings, "aspect", "9:16")
    fit_mode = getattr(settings, "fit_mode", "contain")
    return aspect != "original" and fit_mode == "contain"


def should_apply_canvas_in_final_pass(settings) -> bool:
    aspect = getattr(settings, "aspect", "original")
    fit_mode = getattr(settings, "fit_mode", "contain")
    return aspect != "original" and fit_mode in ("contain_blur", "cover")


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
    return {
        "outline": block.overlay.outline,
        "content": block.overlay.content,
        "recommend_reason": block.overlay.recommend_reason,
    }


def _block_duration(block: EditBlock) -> float:
    duration = float(block.trim.out_sec - block.trim.in_sec)
    if duration > 0:
        return duration
    if block.duration_sec > 0:
        return float(block.duration_sec)
    return 0.0


def _probe_duration(path: Path) -> float:
    info = VideoProcessor.get_video_info(path)
    return float(info.get("duration") or 0.0)


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
    style_config = overlay_config or {}

    canvas_size: Optional[Tuple[int, int]] = None
    frame_vf: Optional[str] = None
    if export_settings is not None and should_apply_canvas_per_segment(export_settings):
        canvas_size = target_dimensions(export_settings)
        frame_vf = build_frame_filter(export_settings)

    vf: Optional[str] = None
    if burn_subtitles:
        overlay_w, overlay_h = canvas_size if canvas_size else (None, None)
        vf = VideoProcessor._build_cinema_subtitles_filter(
            clip_data,
            output_path,
            input_video,
            duration,
            style_config,
            canvas_width=overlay_w,
            canvas_height=overlay_h,
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

    if transition != "dissolve":
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
    filter_complex = (
        f"[0:v][1:v]xfade=transition=fade:duration={dissolve}:offset={offset}[vout];"
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
    vol = max(0.0, min(float(bgm_volume), 1.0))
    ratio = max(2.0, min(float(duck_ratio), 20.0))
    if duck_enabled:
        filter_complex = (
            f"[1:a]volume={vol},afade=t=in:st=0:d={fade_in},"
            f"afade=t=out:st={fade_out_start}:d={fade_out}[bgm];"
            f"[bgm][0:a]sidechaincompress=threshold=0.02:ratio={ratio}:attack=8:release=250[bgm_duck];"
            f"[0:a][bgm_duck]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
    else:
        filter_complex = (
            f"[1:a]volume={vol},afade=t=in:st=0:d={fade_in},"
            f"afade=t=out:st={fade_out_start}:d={fade_out}[bgm];"
            f"[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
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
        if index < len(session.sequence) and block.transition_out == "dissolve":
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
    def report(progress: int, message: str) -> None:
        if progress_callback is not None:
            progress_callback(max(0, min(progress, 100)), message)

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

    bgm_rel = session.audio_settings.bgm_path
    if bgm_rel:
        bgm_path = project_dir / bgm_rel
        if bgm_path.exists():
            report(92, "混音 BGM")
            if not mix_bgm_track(
                merged_path,
                bgm_path,
                output_path,
                bgm_volume=session.audio_settings.bgm_volume,
                fade_in_sec=session.audio_settings.fade_in_sec,
                fade_out_sec=session.audio_settings.fade_out_sec,
                duck_enabled=session.audio_settings.bgm_duck_enabled,
                duck_ratio=session.audio_settings.bgm_duck_ratio,
            ):
                shutil.copy2(merged_path, output_path)
        else:
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
    return build_overlay_preview(block_to_clip_data(block), pipeline)

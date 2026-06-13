"""
视频处理工具
"""
import subprocess
import json
import logging
import os
import platform
import re
import textwrap
from typing import Any, List, Dict, Optional
from pathlib import Path
from .ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path

# 修复导入问题
try:
    from ..core.shared_config import CLIPS_DIR, COLLECTIONS_DIR
except ImportError:
    # 如果相对导入失败，尝试绝对导入
    import sys
    from pathlib import Path
    backend_path = Path(__file__).parent.parent
    if str(backend_path) not in sys.path:
        sys.path.insert(0, str(backend_path))
    from ..core.shared_config import CLIPS_DIR, COLLECTIONS_DIR

logger = logging.getLogger(__name__)

class VideoProcessor:
    """视频处理工具类"""
    
    def __init__(self, clips_dir: Optional[str] = None, collections_dir: Optional[str] = None):
        # 强制使用传入的项目特定路径，不使用全局路径作为后备
        if not clips_dir:
            raise ValueError("clips_dir 参数是必需的，不能使用全局路径")
        if not collections_dir:
            raise ValueError("collections_dir 参数是必需的，不能使用全局路径")
        
        self.clips_dir = Path(clips_dir)
        self.collections_dir = Path(collections_dir)
    
    @staticmethod
    def sanitize_filename(filename: str) -> str:
        """
        清理文件名，移除或替换不合法的字符
        
        Args:
            filename: 原始文件名
            
        Returns:
            清理后的文件名
        """
        # 移除或替换不合法的字符
        # Windows和Unix系统都不允许的字符: < > : " | ? * \ /
        # 替换为下划线
        sanitized = re.sub(r'[<>:"|?*\\/]', '_', filename)
        
        # 移除前后空格和点
        sanitized = sanitized.strip(' .')
        
        # 限制长度，避免文件名过长
        if len(sanitized) > 100:
            sanitized = sanitized[:100]
        
        # 确保文件名不为空
        if not sanitized:
            sanitized = "untitled"
            
        return sanitized
    
    @staticmethod
    def convert_srt_time_to_ffmpeg_time(srt_time: str) -> str:
        """
        将SRT时间格式转换为FFmpeg时间格式
        
        Args:
            srt_time: SRT时间格式 (如 "00:00:06,140" 或 "00:00:06.140")
            
        Returns:
            FFmpeg时间格式 (如 "00:00:06.140")
        """
        # 将逗号替换为点
        return srt_time.replace(',', '.')
    
    @staticmethod
    def convert_seconds_to_ffmpeg_time(seconds: float) -> str:
        """
        将秒数转换为FFmpeg时间格式
        
        Args:
            seconds: 秒数
            
        Returns:
            FFmpeg时间格式 (如 "00:00:06.140")
        """
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        milliseconds = int((seconds % 1) * 1000)
        
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"
    
    @staticmethod
    def convert_ffmpeg_time_to_seconds(time_str: str) -> float:
        """
        将FFmpeg时间格式转换为秒数
        
        Args:
            time_str: FFmpeg时间格式 (如 "00:00:06.140")
            
        Returns:
            秒数
        """
        try:
            # 处理毫秒部分
            if '.' in time_str:
                time_part, ms_part = time_str.split('.')
                milliseconds = int(ms_part)
            else:
                time_part = time_str
                milliseconds = 0
            
            # 解析时分秒
            h, m, s = map(int, time_part.split(':'))
            
            return h * 3600 + m * 60 + s + milliseconds / 1000
        except Exception as e:
            logger.error(f"时间格式转换失败: {time_str}, 错误: {e}")
            return 0.0
    

    @staticmethod
    def _default_cjk_font_candidates() -> List[Path]:
        """Return CJK-capable font candidates for bundled, Docker, macOS, Windows, Linux."""
        backend_dir = Path(__file__).resolve().parent.parent
        candidates = [
            backend_dir / "assets" / "fonts" / "NotoSansCJKsc-Regular.otf",
            backend_dir / "assets" / "fonts" / "SourceHanSansSC-Regular.otf",
            backend_dir / "assets" / "fonts" / "NotoSansSC-Regular.otf",
        ]

        system = platform.system().lower()
        if system == "darwin":
            candidates.extend([
                Path("/System/Library/Fonts/PingFang.ttc"),
                Path("/System/Library/Fonts/STHeiti Light.ttc"),
                Path("/Library/Fonts/Arial Unicode.ttf"),
            ])
        elif system == "windows":
            windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
            candidates.extend([
                windir / "Fonts" / "msyh.ttc",
                windir / "Fonts" / "simhei.ttf",
                windir / "Fonts" / "simsun.ttc",
            ])
        else:
            candidates.extend([
                Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
                Path("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf"),
                Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
                Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
                Path("/usr/share/fonts/truetype/arphic/ukai.ttc"),
            ])
        return candidates

    @staticmethod
    def _resolve_subtitle_font(style_config: Optional[Dict[str, Any]] = None) -> Optional[Path]:
        """Resolve a font that can render Chinese text across deployment modes."""
        style_config = style_config or {}
        explicit = (
            style_config.get("font_file")
            or style_config.get("font_path")
            or os.getenv("AUTOCLIP_SUBTITLE_FONT_PATH")
        )
        candidates: List[Path] = []
        if explicit:
            candidates.append(Path(str(explicit)).expanduser())
        candidates.extend(VideoProcessor._default_cjk_font_candidates())
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate
        return None

    @staticmethod
    def _escape_filter_value(value: str) -> str:
        """Escape a value embedded in a single-quoted FFmpeg filter argument."""
        escaped = value.replace("\\", "\\\\")
        escaped = escaped.replace(":", "\\:")
        escaped = escaped.replace("'", r"\\'")
        escaped = escaped.replace(",", r"\,")
        return escaped

    @staticmethod
    def _normalize_ffmpeg_color(value: Any, default: str) -> str:
        """Normalize CSS-like colors to FFmpeg color syntax."""
        text = str(value or default).strip()
        raw = text[1:] if text.startswith("#") else text
        if re.fullmatch(r"[0-9A-Fa-f]{6}", raw):
            return f"0x{raw}"
        if re.fullmatch(r"[0-9A-Fa-f]{8}", raw):
            alpha = int(raw[6:8], 16) / 255
            return f"0x{raw[:6]}@{alpha:.3f}"
        return text or default

    @staticmethod
    def _wrap_overlay_text(text: str, max_chars_per_line: int) -> str:
        text = " ".join((text or "").split())
        if not text or max_chars_per_line <= 0:
            return text
        if len(text) <= max_chars_per_line:
            return text
        lines = textwrap.wrap(
            text,
            width=max_chars_per_line,
            break_long_words=True,
            break_on_hyphens=False,
        )
        return "\n".join(lines[:2])

    @staticmethod
    def _build_drawtext_filter(
        overlay_text: str,
        output_path: Path,
        style_config: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """Build a UTF-8 safe drawtext filter for quote/title overlay."""
        style_config = style_config or {}
        font_path = VideoProcessor._resolve_subtitle_font(style_config)
        if not font_path:
            logger.warning(
                "未找到可用中文字体，跳过文字叠加以避免视频底部出现方块乱码。"
                "可设置 AUTOCLIP_SUBTITLE_FONT_PATH 或在 backend/assets/fonts 放置 NotoSansCJKsc-Regular.otf。"
            )
            return None

        max_chars = int(style_config.get("max_chars_per_line", 18) or 18)
        display_text = VideoProcessor._wrap_overlay_text(overlay_text.strip(), max_chars)
        text_file = output_path.with_suffix(output_path.suffix + ".overlay.txt")
        text_file.write_text(display_text, encoding="utf-8")

        font_size = int(style_config.get("font_size", 42) or 42)
        font_color = VideoProcessor._normalize_ffmpeg_color(style_config.get("font_color"), "white")
        border_color = VideoProcessor._normalize_ffmpeg_color(style_config.get("border_color"), "black")
        border_width = int(style_config.get("border_width", 3) or 3)
        margin_bottom = int(style_config.get("margin_bottom", 80) or 80)
        line_spacing = int(style_config.get("line_spacing", 8) or 8)
        x_expr = str(style_config.get("x", "(w-text_w)/2"))
        y_expr = str(style_config.get("y", f"h-text_h-{margin_bottom}"))

        parts = [
            "drawtext="
            f"fontfile='{VideoProcessor._escape_filter_value(font_path.as_posix())}'"
            f":textfile='{VideoProcessor._escape_filter_value(text_file.as_posix())}'",
            f"fontsize={font_size}",
            f"fontcolor={font_color}",
            f"borderw={border_width}",
            f"bordercolor={border_color}",
            f"line_spacing={line_spacing}",
            f"x={x_expr}",
            f"y={y_expr}",
        ]

        if style_config.get("box", True):
            box_color = VideoProcessor._normalize_ffmpeg_color(style_config.get("box_color"), "black@0.50")
            box_border_width = int(style_config.get("box_border_width", 18) or 18)
            parts.extend(["box=1", f"boxcolor={box_color}", f"boxborderw={box_border_width}"])

        shadow_x = int(style_config.get("shadow_x", 0) or 0)
        shadow_y = int(style_config.get("shadow_y", 0) or 0)
        if shadow_x or shadow_y:
            shadow_color = VideoProcessor._normalize_ffmpeg_color(style_config.get("shadow_color"), "black")
            parts.extend([f"shadowx={shadow_x}", f"shadowy={shadow_y}", f"shadowcolor={shadow_color}"])

        return ":".join(parts)

    @staticmethod
    def _probe_video_dimensions(input_video: Path) -> tuple[int, int]:
        """读取视频宽高，供字幕排版缩放。"""
        try:
            ffprobe_bin = get_ffprobe_path()
            result = subprocess.run(
                [
                    ffprobe_bin,
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height",
                    "-of",
                    "json",
                    str(input_video),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            if result.returncode != 0:
                raise ValueError(result.stderr[:200])
            payload = json.loads(result.stdout or "{}")
            streams = payload.get("streams") or []
            if not streams:
                raise ValueError("no video stream")
            width = int(streams[0].get("width") or 720)
            height = int(streams[0].get("height") or 1280)
            return width, height
        except Exception as exc:
            logger.warning("读取视频尺寸失败，使用默认 720x1280: %s", exc)
            return 720, 1280

    @staticmethod
    def _escape_subtitles_path(path: Path) -> str:
        escaped = path.resolve().as_posix().replace(":", "\\:")
        escaped = escaped.replace("'", r"\'")
        return escaped

    @staticmethod
    def _build_cinema_subtitles_filter(
        clip_data: Dict[str, Any],
        output_path: Path,
        input_video: Path,
        duration_sec: float,
        style_config: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """生成左下角影视感多层 ASS 字幕滤镜。"""
        from backend.pipeline.quote_overlay_composer import compose_quote_cinema_layers
        from backend.utils.ass_subtitle_builder import AssSubtitleBuilder, resolve_cinema_fonts

        style_config = style_config or {}
        fonts = resolve_cinema_fonts(style_config)
        if not fonts:
            logger.warning(
                "未找到影视感字幕字体（中文+手写体），跳过 quote_cinema 叠加。"
            )
            return None

        width, height = VideoProcessor._probe_video_dimensions(input_video)
        layers = compose_quote_cinema_layers(clip_data, style_config)
        if not layers:
            return None

        builder = AssSubtitleBuilder(fonts, style_config)
        ass_path = builder.build(
            layers,
            output_path,
            width=width,
            height=height,
            duration_sec=duration_sec,
        )

        ass_arg = VideoProcessor._escape_filter_value(ass_path.name)
        return f"subtitles={ass_arg}"

    @staticmethod
    def _escape_drawtext(text: str) -> str:
        escaped = text.replace("\\", "\\\\")
        escaped = escaped.replace(":", "\\:")
        escaped = escaped.replace("'", "\\'")
        escaped = escaped.replace("%", "\\%")
        return escaped[:80]

    @staticmethod
    def extract_clip(input_video: Path, output_path: Path, 
                    start_time: str, end_time: str,
                    *,
                    subtitle_style: str = "default",
                    overlay_text: Optional[str] = None,
                    overlay_clip_data: Optional[Dict[str, Any]] = None,
                    subtitle_config: Optional[Dict[str, Any]] = None) -> bool:
        """
        从视频中提取指定时间段的片段
        
        Args:
            input_video: 输入视频路径
            output_path: 输出视频路径
            start_time: 开始时间 (格式: "00:01:25,140")
            end_time: 结束时间 (格式: "00:02:53,500")
            
        Returns:
            是否成功
        """
        try:
            # 确保输出目录存在
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 转换时间格式：从SRT格式转换为FFmpeg格式
            ffmpeg_start_time = VideoProcessor.convert_srt_time_to_ffmpeg_time(start_time)
            ffmpeg_end_time = VideoProcessor.convert_srt_time_to_ffmpeg_time(end_time)
            
            # 计算持续时间
            start_seconds = VideoProcessor.convert_ffmpeg_time_to_seconds(ffmpeg_start_time)
            end_seconds = VideoProcessor.convert_ffmpeg_time_to_seconds(ffmpeg_end_time)
            duration = end_seconds - start_seconds
            
            ffmpeg_bin = get_ffmpeg_path()
            use_cinema_overlay = (
                subtitle_style == "quote_cinema"
                and overlay_clip_data
            )
            use_quote_overlay = (
                subtitle_style == "quote_highlight"
                and overlay_text
                and overlay_text.strip()
            )
            use_text_overlay = use_cinema_overlay or use_quote_overlay

            if use_cinema_overlay:
                vf = VideoProcessor._build_cinema_subtitles_filter(
                    overlay_clip_data,
                    output_path,
                    input_video,
                    duration,
                    subtitle_config,
                )
                if not vf:
                    logger.warning("quote_cinema 字体不可用，回退为 drawtext: %s", output_path)
                    from backend.pipeline.quote_overlay_composer import get_quote_overlay_fallback_text

                    fallback_config = dict(subtitle_config or {})
                    fallback_config.setdefault("x", "48")
                    fallback_config.setdefault("y", "h-text_h-72")
                    fallback_config.setdefault("font_color", "#E8C872")
                    fallback_config.setdefault("box", False)
                    fallback_config.setdefault("font_size", 36)
                    return VideoProcessor.extract_clip(
                        input_video,
                        output_path,
                        start_time,
                        end_time,
                        subtitle_style="quote_highlight",
                        overlay_text=get_quote_overlay_fallback_text(
                            overlay_clip_data or {},
                            subtitle_config,
                        ),
                        subtitle_config=fallback_config,
                    )
            elif use_quote_overlay:
                vf = VideoProcessor._build_drawtext_filter(
                    overlay_text.strip(),
                    output_path,
                    subtitle_config,
                )
                if not vf:
                    logger.warning("quote_highlight 字体不可用，回退为无叠加导出: %s", output_path)
                    return VideoProcessor.extract_clip(
                        input_video,
                        output_path,
                        start_time,
                        end_time,
                        subtitle_style="default",
                    )
            else:
                vf = None

            if use_text_overlay and vf:
                input_arg = str(input_video.resolve())
                output_arg = str(output_path.resolve())
                cmd = [
                    ffmpeg_bin,
                    '-ss', ffmpeg_start_time,
                    '-i', input_arg,
                    '-t', str(duration),
                    '-vf', vf,
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-crf', '23',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-avoid_negative_ts', 'make_zero',
                    '-y',
                    output_arg,
                ]
                ffmpeg_cwd = str(output_path.parent) if use_cinema_overlay else None
            else:
                ffmpeg_cwd = None
                cmd = [
                    ffmpeg_bin,
                    '-ss', ffmpeg_start_time,  # 在输入前定位，更精确
                    '-i', str(input_video),
                    '-t', str(duration),  # 使用持续时间而不是绝对结束时间
                    '-c:v', 'copy',  # 复制视频流
                    '-c:a', 'copy',  # 复制音频流
                    '-avoid_negative_ts', 'make_zero',
                    '-y',  # 覆盖输出文件
                    str(output_path),
                ]
            
            # 执行命令
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='ignore',
                cwd=ffmpeg_cwd,
            )
            if use_quote_overlay:
                overlay_sidecar = output_path.with_suffix(output_path.suffix + ".overlay.txt")
                overlay_sidecar.unlink(missing_ok=True)
            if use_cinema_overlay:
                ass_sidecar = output_path.with_suffix(output_path.suffix + ".overlay.ass")
                ass_sidecar.unlink(missing_ok=True)
            
            if result.returncode == 0:
                logger.info(f"成功提取视频片段: {output_path} ({ffmpeg_start_time} -> {ffmpeg_end_time}, 时长: {duration:.2f}秒)")
                return True

            if use_text_overlay:
                if use_cinema_overlay:
                    logger.warning(
                        "quote_cinema 叠加失败，回退为 drawtext: %s",
                        result.stderr[:300],
                    )
                    from backend.pipeline.quote_overlay_composer import get_quote_overlay_fallback_text

                    fallback_config = dict(subtitle_config or {})
                    fallback_config.setdefault("x", "48")
                    fallback_config.setdefault("y", "h-text_h-72")
                    fallback_config.setdefault("font_color", "#E8C872")
                    fallback_config.setdefault("box", False)
                    fallback_config.setdefault("font_size", 36)
                    fallback_text = get_quote_overlay_fallback_text(
                        overlay_clip_data or {},
                        subtitle_config,
                    )
                    return VideoProcessor.extract_clip(
                        input_video,
                        output_path,
                        start_time,
                        end_time,
                        subtitle_style="quote_highlight",
                        overlay_text=fallback_text,
                        subtitle_config=fallback_config,
                    )
                logger.warning("quote_highlight 叠加失败，回退为 stream copy: %s", result.stderr[:200])
                return VideoProcessor.extract_clip(
                    input_video,
                    output_path,
                    start_time,
                    end_time,
                    subtitle_style="default",
                )

            logger.error(f"提取视频片段失败: {result.stderr}")
            return False
                
        except Exception as e:
            logger.error(f"视频处理异常: {str(e)}")
            return False
    
    @staticmethod
    def create_collection(clips_list: List[Path], output_path: Path) -> bool:
        """
        将多个视频片段拼接成合集
        
        Args:
            clips_list: 视频片段路径列表
            output_path: 输出合集路径
            
        Returns:
            是否成功
        """
        try:
            # 验证输入参数
            if not clips_list:
                logger.error("clips_list为空，无法创建合集")
                return False
            
            # 验证所有视频文件是否存在
            valid_clips = []
            for clip_path in clips_list:
                if not clip_path.exists():
                    logger.warning(f"视频文件不存在，跳过: {clip_path}")
                    continue
                valid_clips.append(clip_path)
            
            if not valid_clips:
                logger.error("没有有效的视频文件，无法创建合集")
                return False
            
            # 确保输出目录存在
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 创建concat文件
            concat_file = output_path.parent / "concat_list.txt"
            
            with open(concat_file, 'w', encoding='utf-8') as f:
                for clip_path in valid_clips:
                    # 使用绝对路径并转义单引号
                    abs_path = clip_path.absolute()
                    escaped_path = str(abs_path).replace("'", "'\"'\"'")
                    f.write(f"file '{escaped_path}'\n")
            
            # 验证concat文件内容
            if concat_file.stat().st_size == 0:
                logger.error("concat文件为空，无法创建合集")
                concat_file.unlink(missing_ok=True)
                return False
            
            # 构建FFmpeg命令 - 使用H.264编码确保兼容性
            ffmpeg_bin = get_ffmpeg_path()
            cmd = [
                ffmpeg_bin,
                '-f', 'concat',
                '-safe', '0',
                '-i', str(concat_file),
                '-c:v', 'libx264',  # 使用H.264视频编码
                '-preset', 'ultrafast',  # 使用最快的编码预设
                '-crf', '28',  # 稍微降低质量以加快编码速度
                '-c:a', 'aac',  # 使用AAC音频编码
                '-b:a', '128k',  # 音频比特率
                '-movflags', '+faststart',  # 优化网络播放
                '-y',
                str(output_path)
            ]
            
            logger.info(f"执行FFmpeg命令: {' '.join(cmd)}")
            
            # 执行命令
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
            
            # 清理临时文件
            concat_file.unlink(missing_ok=True)
            
            if result.returncode == 0:
                logger.info(f"成功创建合集: {output_path}")
                return True
            else:
                logger.error(f"创建合集失败: {result.stderr}")
                logger.error(f"FFmpeg stdout: {result.stdout}")
                return False
                
        except Exception as e:
            logger.error(f"视频拼接异常: {str(e)}")
            return False
    
    @staticmethod
    def extract_thumbnail(video_path: Path, output_path: Path, time_offset: int = 5) -> bool:
        """
        从视频中提取缩略图
        
        Args:
            video_path: 视频文件路径
            output_path: 输出缩略图路径
            time_offset: 提取时间点（秒）
            
        Returns:
            是否成功
        """
        try:
            # 确保输出目录存在
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 构建FFmpeg命令
            cmd = [
                'ffmpeg',
                '-i', str(video_path),
                '-ss', str(time_offset),
                '-vframes', '1',
                '-q:v', '2',  # 高质量
                '-y',  # 覆盖输出文件
                str(output_path)
            ]
            
            # 执行命令
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
            
            if result.returncode == 0 and output_path.exists():
                logger.info(f"成功提取缩略图: {output_path}")
                return True
            else:
                logger.error(f"提取缩略图失败: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"提取缩略图异常: {str(e)}")
            return False
    
    @staticmethod
    def get_video_info(video_path: Path) -> Dict:
        """
        获取视频信息
        
        Args:
            video_path: 视频文件路径
            
        Returns:
            视频信息字典
        """
        try:
            ffprobe_bin = get_ffprobe_path()
            cmd = [
                ffprobe_bin,
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                str(video_path)
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
            
            if result.returncode == 0:
                info = json.loads(result.stdout)
                return {
                    'duration': float(info['format']['duration']),
                    'size': int(info['format']['size']),
                    'bitrate': int(info['format']['bit_rate']),
                    'streams': info['streams']
                }
            else:
                logger.error(f"获取视频信息失败: {result.stderr}")
                return {}
                
        except Exception as e:
            logger.error(f"获取视频信息异常: {str(e)}")
            return {}
    
    def batch_extract_clips(
        self,
        input_video: Path,
        clips_data: List[Dict],
        *,
        subtitle_style: str = "default",
        subtitle_config: Optional[Dict[str, Any]] = None,
    ) -> List[Path]:
        """
        批量提取视频片段
        
        Args:
            input_video: 输入视频路径
            clips_data: 片段数据列表，每个元素包含id、title、start_time、end_time
            
        Returns:
            成功提取的片段路径列表
        """
        successful_clips = []
        
        for clip_data in clips_data:
            clip_id = clip_data['id']
            title = clip_data.get('title', f"片段_{clip_id}")
            start_time = clip_data['start_time']
            end_time = clip_data['end_time']
            
            # 处理时间格式 - 如果是秒数，转换为SRT格式
            if isinstance(start_time, (int, float)):
                start_time = VideoProcessor.convert_seconds_to_ffmpeg_time(start_time)
            if isinstance(end_time, (int, float)):
                end_time = VideoProcessor.convert_seconds_to_ffmpeg_time(end_time)
            
            # 使用标题作为文件名，并清理不合法的字符
            # 在文件名中包含clip_id，便于后续合集拼接时查找
            safe_title = VideoProcessor.sanitize_filename(title)
            output_path = self.clips_dir / f"{clip_id}_{safe_title}.mp4"
            
            logger.info(f"提取切片 {clip_id}: {start_time} -> {end_time}, 输出: {output_path}")
            
            if VideoProcessor.extract_clip(
                input_video,
                output_path,
                start_time,
                end_time,
                subtitle_style=subtitle_style,
                overlay_text=title if subtitle_style == "quote_highlight" else None,
                overlay_clip_data=clip_data if subtitle_style == "quote_cinema" else None,
                subtitle_config=subtitle_config,
            ):
                successful_clips.append(output_path)
                logger.info(f"切片 {clip_id} 提取成功")
            else:
                logger.error(f"切片 {clip_id} 提取失败")
        
        return successful_clips
    
    def create_collections_from_metadata(self, collections_data: List[Dict]) -> List[Dict]:
        """
        根据元数据创建合集
        
        Args:
            collections_data: 合集数据列表
            
        Returns:
            成功创建的合集信息列表，包含视频路径和缩略图路径
        """
        successful_collections = []
        
        for collection_data in collections_data:
            collection_id = collection_data['id']
            collection_title = collection_data.get('collection_title', f'合集_{collection_id}')
            clip_ids = collection_data['clip_ids']
            
            # 构建片段路径列表
            clips_list = []
            for clip_id in clip_ids:
                # 查找对应的切片文件
                # 新的文件名格式是: {clip_id}_{title}.mp4
                clip_path = self.clips_dir / f"{clip_id}_*.mp4"
                found_clips = list(self.clips_dir.glob(f"{clip_id}_*.mp4"))
                
                if found_clips:
                    found_clip = found_clips[0]  # 取第一个匹配的文件
                    clips_list.append(found_clip)
                    logger.info(f"找到合集 {collection_id} 的切片: {found_clip.name}")
                else:
                    logger.warning(f"未找到合集 {collection_id} 的切片 {clip_id}")
            
            if clips_list:
                # 使用collection_title作为文件名，并清理不合法的字符
                safe_title = VideoProcessor.sanitize_filename(collection_title)
                output_path = self.collections_dir / f"{safe_title}.mp4"
                
                if VideoProcessor.create_collection(clips_list, output_path):
                    # 生成合集缩略图
                    thumbnail_path = None
                    try:
                        thumbnail_filename = f"{collection_id}_{safe_title}_thumbnail.jpg"
                        thumbnail_path = self.collections_dir / thumbnail_filename
                        
                        # 从视频中提取缩略图（第2秒的帧）
                        thumbnail_success = VideoProcessor.extract_thumbnail(output_path, thumbnail_path, time_offset=2)
                        if thumbnail_success:
                            logger.info(f"合集 {collection_id} 缩略图生成成功: {thumbnail_path}")
                        else:
                            logger.warning(f"合集 {collection_id} 缩略图生成失败")
                            thumbnail_path = None
                    except Exception as e:
                        logger.error(f"生成合集 {collection_id} 缩略图时出错: {e}")
                        thumbnail_path = None
                    
                    # 返回包含视频路径和缩略图路径的信息
                    collection_info = {
                        'collection_id': collection_id,
                        'video_path': str(output_path),
                        'thumbnail_path': str(thumbnail_path) if thumbnail_path else None,
                        'title': collection_title
                    }
                    successful_collections.append(collection_info)
                    logger.info(f"成功创建合集 {collection_id}: {output_path}")
            else:
                logger.warning(f"合集 {collection_id} 没有找到任何有效的切片文件")
        
        return successful_collections
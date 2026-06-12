"""解析切片视频文件路径（DB 路径与磁盘文件名不一致时的回退逻辑）。"""

import logging
from pathlib import Path
from typing import Any, Optional

from backend.core.path_utils import get_project_directory

logger = logging.getLogger(__name__)


def resolve_clip_video_path(
    project_id: str,
    clip: Any,
    project_dir: Optional[Path] = None,
) -> Optional[Path]:
    """
    查找切片 mp4 实际路径。
    优先 clip.video_path；否则按 metadata.id（流水线序号 1/2/3…）在 output/clips 下 glob。
    """
    if project_dir is None:
        project_dir = get_project_directory(project_id)

    clips_dir = project_dir / "output" / "clips"
    if not clips_dir.exists():
        return None

    stored = getattr(clip, "video_path", None)
    if stored:
        path = Path(stored)
        if path.exists():
            return path
        # DB 里可能是相对路径或旧目录
        if not path.is_absolute():
            alt = project_dir / path
            if alt.exists():
                return alt

    metadata = getattr(clip, "clip_metadata", None) or {}
    pipeline_id = metadata.get("id")
    if pipeline_id is not None:
        matches = sorted(clips_dir.glob(f"{pipeline_id}_*.mp4"))
        if matches:
            return matches[0]

    # 最后尝试：按标题前缀模糊匹配
    title = getattr(clip, "title", None) or metadata.get("generated_title") or ""
    if title:
        snippet = title[:12]
        for candidate in clips_dir.glob("*.mp4"):
            if snippet and snippet in candidate.name:
                return candidate

    return None

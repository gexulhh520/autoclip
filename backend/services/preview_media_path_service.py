"""解析剪辑预览媒体的本地绝对路径（仅桌面端）。"""
from __future__ import annotations

from pathlib import Path

from backend.core.path_utils import get_project_directory, is_desktop_mode, resolve_source_video_path
from backend.pipeline.edit_renderer import _resolve_input_video
from backend.services.edit_session_service import EditSessionService
from backend.utils.clip_path_resolver import resolve_clip_video_path


class PreviewMediaPathError(ValueError):
    """预览媒体路径不可用。"""


def _require_desktop() -> None:
    if not is_desktop_mode():
        raise PreviewMediaPathError("本地媒体路径仅在桌面模式下可用")


def resolve_edit_block_media_path(
    service: EditSessionService,
    project_id: str,
    session_id: str,
    block_id: str,
) -> Path:
    _require_desktop()
    session = service.get_session(project_id, session_id)
    block = next((item for item in session.sequence if item.id == block_id), None)
    if block is None:
        raise PreviewMediaPathError("片段不存在")
    project_dir = get_project_directory(project_id)
    return _resolve_input_video(project_dir, block)


def resolve_project_clip_path(
    project_id: str,
    clip_id: str,
    *,
    db,
) -> Path:
    _require_desktop()
    from backend.models.clip import Clip

    clip = (
        db.query(Clip)
        .filter(Clip.id == clip_id, Clip.project_id == project_id)
        .first()
    )
    if clip is None:
        raise PreviewMediaPathError("切片不存在")
    project_dir = get_project_directory(project_id)
    video_file = resolve_clip_video_path(project_id, clip, project_dir)
    if video_file is None or not video_file.exists():
        raise PreviewMediaPathError("切片视频文件不存在")
    return video_file.resolve()


def resolve_edit_audio_asset_path(
    service: EditSessionService,
    project_id: str,
    session_id: str,
    asset_id: str,
) -> Path:
    _require_desktop()
    from backend.utils.bgm_audio import ensure_browser_playable_bgm

    asset_path = service.resolve_audio_asset_path(project_id, session_id, asset_id)
    return ensure_browser_playable_bgm(asset_path).resolve()


def resolve_project_source_video_path(
    project_id: str,
    source_id: str | None = None,
    *,
    project_video_path: str | None = None,
) -> Path:
    _require_desktop()
    if source_id:
        video_path = resolve_source_video_path(project_id, source_id)
    else:
        video_path = get_project_directory(project_id) / "raw" / "input.mp4"
        if not video_path.exists() and project_video_path:
            alt = Path(project_video_path)
            if alt.exists():
                video_path = alt
    if not video_path.exists() or video_path.stat().st_size == 0:
        raise PreviewMediaPathError("原视频文件不存在")
    return video_path.resolve()

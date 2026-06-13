"""将剪辑导出文件复制到用户指定本地目录。"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Optional, Tuple

from backend.core.path_utils import get_data_directory


def get_default_editor_export_dir() -> Path:
    export_dir = get_data_directory() / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    return export_dir.resolve()


def resolve_export_output_dir(output_dir: Optional[str]) -> Path:
    if output_dir and output_dir.strip():
        dest = Path(output_dir.strip()).expanduser().resolve()
    else:
        dest = get_default_editor_export_dir()
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def copy_export_file(source: Path, output_dir: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError(str(source))
    dest = output_dir / source.name
    shutil.copy2(source, dest)
    return dest.resolve()


def copy_export_outputs(
    output_path: Path,
    srt_path: Optional[Path],
    output_dir: Optional[str],
) -> Tuple[Path, Optional[Path]]:
    dest_dir = resolve_export_output_dir(output_dir)
    local_video = copy_export_file(output_path, dest_dir)
    local_srt = copy_export_file(srt_path, dest_dir) if srt_path is not None else None
    return local_video, local_srt

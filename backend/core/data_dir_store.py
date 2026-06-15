"""持久化桌面版数据目录（与具体 data 内容分离，便于切换/找回旧配置）。"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from backend.core.path_utils import get_default_desktop_app_dir, get_project_root

logger = logging.getLogger(__name__)

BOOTSTRAP_FILENAME = "app_paths.json"


def get_bootstrap_file() -> Path:
    bootstrap_dir = get_default_desktop_app_dir()
    bootstrap_dir.mkdir(parents=True, exist_ok=True)
    return bootstrap_dir / BOOTSTRAP_FILENAME


def load_persisted_data_dir() -> Optional[Path]:
    bootstrap = get_bootstrap_file()
    if not bootstrap.is_file():
        return None
    try:
        payload = json.loads(bootstrap.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("读取数据目录配置失败 %s: %s", bootstrap, exc)
        return None
    raw = payload.get("data_dir")
    if not raw or not str(raw).strip():
        return None
    return Path(str(raw)).expanduser()


def save_persisted_data_dir(data_dir: Path) -> Path:
    bootstrap = get_bootstrap_file()
    resolved = data_dir.expanduser().resolve()
    payload = {"data_dir": str(resolved)}
    bootstrap.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("已保存数据目录配置: %s -> %s", bootstrap, resolved)
    return bootstrap


def clear_persisted_data_dir() -> None:
    bootstrap = get_bootstrap_file()
    if bootstrap.is_file():
        bootstrap.unlink(missing_ok=True)


def list_data_dir_candidates() -> list[Dict[str, Any]]:
    """常见历史数据目录，供设置页提示用户找回配置。"""
    seen: set[str] = set()
    candidates: list[Dict[str, Any]] = []

    def add(path: Path, label: str) -> None:
        resolved = path.expanduser()
        key = str(resolved).lower()
        if key in seen:
            return
        seen.add(key)
        exists = resolved.is_dir()
        candidates.append(
            {
                "label": label,
                "path": str(resolved),
                "exists": exists,
                "has_settings": (resolved / "settings.json").is_file() if exists else False,
                "has_whisper_runtime": (resolved / "whisper-runtime").is_dir() if exists else False,
                "has_whisper_models": (resolved / "whisper-models").is_dir() if exists else False,
            }
        )

    persisted = load_persisted_data_dir()
    if persisted:
        add(persisted, "已保存的数据目录")

    add(get_default_desktop_app_dir(), "系统默认（%LOCALAPPDATA%\\AutoClip）")
    add(get_project_root() / "data", "开发模式（项目 data/）")

    return candidates


def get_data_dir_info() -> Dict[str, Any]:
    from backend.core.path_utils import get_data_directory

    data_dir = get_data_directory()
    bootstrap = get_bootstrap_file()
    persisted = load_persisted_data_dir()

    def dir_size_mb(path: Path) -> Optional[float]:
        if not path.is_dir():
            return None
        total = 0
        try:
            for item in path.rglob("*"):
                if item.is_file():
                    total += item.stat().st_size
        except OSError:
            return None
        return round(total / (1024 * 1024), 1)

    return {
        "data_directory": str(data_dir),
        "bootstrap_file": str(bootstrap),
        "persisted_data_directory": str(persisted) if persisted else None,
        "size_mb": dir_size_mb(data_dir),
        "candidates": list_data_dir_candidates(),
        "contents": {
            "settings_json": (data_dir / "settings.json").is_file(),
            "speech_recognition_json": (data_dir / "speech_recognition.json").is_file(),
            "whisper_runtime": (data_dir / "whisper-runtime").is_dir(),
            "whisper_models": (data_dir / "whisper-models").is_dir(),
            "autoclip_db": (data_dir / "autoclip.db").is_file(),
        },
    }

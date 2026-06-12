"""Load project-root .env before other backend modules read os.environ."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


def get_project_root() -> Path:
    """AutoClip 项目根目录（含 backend/、frontend/）。"""
    return Path(__file__).resolve().parent.parent.parent


@lru_cache(maxsize=1)
def load_project_env() -> Path | None:
    """
    从项目根目录加载 .env（不覆盖已存在的环境变量）。
    返回 .env 路径；文件不存在则返回 None。
    """
    env_file = get_project_root() / ".env"
    if not env_file.is_file():
        return None

    try:
        from dotenv import load_dotenv

        load_dotenv(env_file, override=False, encoding="utf-8")
    except ImportError:
        # pydantic-settings 未装 dotenv 时跳过
        return None

    return env_file


def env_flag(name: str) -> bool:
    """判断环境变量是否为 true/1/yes/on。"""
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}

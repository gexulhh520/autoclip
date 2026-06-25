from pathlib import Path

import pytest

from backend.services.preview_media_path_service import (
    PreviewMediaPathError,
    resolve_project_source_video_path,
)


def test_resolve_source_video_requires_desktop(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("AUTOCLIP_DESKTOP_MODE", raising=False)
    monkeypatch.delenv("AUTOCLIP_MODE", raising=False)

    with pytest.raises(PreviewMediaPathError, match="桌面模式"):
        resolve_project_source_video_path("proj-1", None)

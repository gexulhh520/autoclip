"""基因模板 E2E 冒烟测试（API + Pipeline 配置链）。"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app_factory import create_app
from backend.pipeline.goals.registry import GOAL_PROFILES
from backend.pipeline.orchestrator import PipelineOrchestrator
from backend.pipeline.template_engine import get_template_engine, merge_template_settings


@pytest.fixture
def client():
    app = create_app(mode="desktop")
    return TestClient(app)


def test_templates_list_api(client: TestClient):
    response = client.get("/api/v1/templates")
    assert response.status_code == 200
    data = response.json()
    assert len(data["templates"]) >= 2
    assert data["default_template"] == "golden_quote_cinema"


def test_template_detail_api(client: TestClient):
    response = client.get("/api/v1/templates/golden_quote_cinema")
    assert response.status_code == 200
    body = response.json()
    assert body["template"]["id"] == "golden_quote_cinema"
    assert body["resolved_settings"]["clip_goal"] == "golden_quote"
    assert body["resolved_settings"]["template_rules"]["subtitle_style"] == "quote_cinema"


def test_template_asset_api(client: TestClient):
    response = client.get("/api/v1/templates/assets/golden_quote_cinema.svg")
    assert response.status_code == 200
    assert "image/svg" in response.headers.get("content-type", "")
    assert "Golden Quote Cinema" in response.text


def test_template_asset_not_found(client: TestClient):
    response = client.get("/api/v1/templates/assets/missing.svg")
    assert response.status_code == 404


def test_orchestrator_build_context_with_template(monkeypatch, tmp_path):
    settings = get_template_engine().resolve_processing_settings("golden_quote_cinema")

    def fake_project_dir(project_id: str) -> Path:
        d = tmp_path / project_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    monkeypatch.setattr(
        "backend.pipeline.orchestrator.get_project_directory",
        fake_project_dir,
    )

    orchestrator = PipelineOrchestrator(
        project_id="tpl-test",
        task_id="task-1",
        settings=settings,
    )
    ctx = orchestrator.build_context(
        input_video_path=str(tmp_path / "input.mp4"),
        input_srt_path=None,
    )

    assert ctx.settings["template_id"] == "golden_quote_cinema"
    assert "影视解说" in ctx.prompts.get("outline", "")
    assert (ctx.metadata_dir / "template_config.json").exists()
    assert ctx.settings["template_rules"]["subtitle_style"] == "quote_cinema"


def test_upload_invalid_template_id_rejected(client: TestClient):
    response = client.post(
        "/api/v1/projects/upload",
        data={
            "project_name": "bad-template",
            "template_id": "not_a_real_template",
        },
        files={"video_file": ("demo.mp4", b"fake", "video/mp4")},
    )
    assert response.status_code == 400


def test_merge_backward_compatible_without_template():
    raw = {"clip_goal": "knowledge", "video_category": "default"}
    assert merge_template_settings(raw) == raw

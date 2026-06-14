"""Compositor export pipeline smoke — fixture compile + render contract."""

import json
from pathlib import Path

import pytest

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "compositor"
GOLDEN_ROOT = FIXTURES_ROOT / "golden"


def _load_session(name: str):
    from backend.schemas.edit_session import EditSession

    data = json.loads((FIXTURES_ROOT / name).read_text(encoding="utf-8"))
    return EditSession.model_validate(data)


def test_export_smoke_minimal_plan_duration():
    from backend.pipeline.scene_builder import compile_export_plan

    session = _load_session("session-minimal.json")
    plan = compile_export_plan(session, burn_subtitles=True)
    assert plan.timeline.total_duration_sec == 4
    assert plan.canvas.width == 608
    assert plan.canvas.height == 1080


def test_export_smoke_dissolve_overlap():
    from backend.pipeline.scene_builder import build_composition_timeline

    session = _load_session("session-dissolve.json")
    timeline = build_composition_timeline(
        session.sequence,
        session.audio_settings.transition_duration_sec,
    )
    assert abs(timeline.total_duration_sec - 6.65) < 0.01


def test_export_smoke_golden_descriptors_exist():
    frame_goldens = [
        "minimal-descriptor-t0.json",
        "dissolve-descriptor-t-mid.json",
        "free-text-descriptor-t1.5.json",
    ]
    for name in frame_goldens:
        path = GOLDEN_ROOT / name
        assert path.is_file(), f"missing golden fixture: {name}"
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload.get("schema_version") == "compositor-1"
        assert payload.get("width", 0) > 0
        assert payload.get("height", 0) > 0

    plan_path = GOLDEN_ROOT / "minimal-plan.json"
    assert plan_path.is_file()
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    assert plan.get("canvas", {}).get("width", 0) > 0


def test_export_smoke_layer_hashes_exist():
    required = [
        "minimal-frame-t0-layers.sha256",
        "dissolve-frame-t-mid-layers.sha256",
        "minimal-frame-t0-mono-soft.sha256",
    ]
    for name in required:
        path = GOLDEN_ROOT / name
        assert path.is_file(), f"missing pixel golden: {name}"
        digest = path.read_text(encoding="utf-8").strip()
        assert len(digest) == 64


def test_compositor_mux_api_route_registered():
    from backend.api.v1 import edit_sessions

    routes = [route.path for route in edit_sessions.router.routes]
    assert any("compositor-mux" in path for path in routes)


@pytest.mark.parametrize(
    "session_file,min_duration",
    [
        ("session-minimal.json", 3.9),
        ("session-dissolve.json", 6.0),
        ("session-free-text.json", 0.5),
    ],
)
def test_export_smoke_sessions_have_sequence(session_file, min_duration):
    session = _load_session(session_file)
    assert len(session.sequence) >= 1
    total = sum(block.duration_sec or 0 for block in session.sequence)
    assert total >= min_duration

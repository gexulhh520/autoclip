"""Compositor fixture parity — timeline / export plan vs committed golden sessions."""

import json
from pathlib import Path

from backend.pipeline.scene_builder import build_composition_timeline, compile_export_plan
from backend.schemas.edit_session import EditSession

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "compositor"


def _load_fixture(name: str) -> EditSession:
    data = json.loads((FIXTURES_ROOT / name).read_text(encoding="utf-8"))
    return EditSession.model_validate(data)


def test_fixture_minimal_timeline_duration():
    session = _load_fixture("session-minimal.json")
    timeline = build_composition_timeline(
        session.sequence,
        session.audio_settings.transition_duration_sec,
    )
    assert timeline.total_duration_sec == 4


def test_fixture_dissolve_timeline_overlap():
    session = _load_fixture("session-dissolve.json")
    timeline = build_composition_timeline(
        session.sequence,
        session.audio_settings.transition_duration_sec,
    )
    assert abs(timeline.total_duration_sec - 6.65) < 0.01
    assert abs(timeline.segments[1].composition_start_sec - 3.65) < 0.01


def test_fixture_minimal_export_plan_canvas():
    session = _load_fixture("session-minimal.json")
    plan = compile_export_plan(session, burn_subtitles=True)
    assert plan.canvas.width == 608
    assert plan.canvas.height == 1080
    assert plan.timeline.total_duration_sec == 4


def test_fixture_dissolve_export_plan_duration():
    session = _load_fixture("session-dissolve.json")
    plan = compile_export_plan(session, burn_subtitles=True)
    assert abs(plan.timeline.total_duration_sec - 6.65) < 0.01


def test_fixture_free_text_overlay_elements():
    session = _load_fixture("session-free-text.json")
    assert len(session.overlay_elements or []) == 1
    assert session.overlay_elements[0].id == "txt-1"


def test_mux_compositor_export_accepts_block_id_kwarg():
    """Regression: batch compositor mux must filter audio by block_id."""
    import inspect

    from backend.pipeline.edit_renderer import mux_compositor_export

    sig = inspect.signature(mux_compositor_export)
    assert "block_id" in sig.parameters


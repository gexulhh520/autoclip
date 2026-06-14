//! CPU compositor MVP — `FrameDescriptor` → RGBA/PNG.
//! Phase 1: clear + layer rects + template text blocks. Video decode arrives in Phase 1.2.

mod render;
mod text;

pub use render::{render_frame, render_frame_png, CompositorError};

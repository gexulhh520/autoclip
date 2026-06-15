//! CPU compositor MVP — `FrameDescriptor` → RGBA/PNG.
//! Phase 1: clear + layer rects + template text blocks. Video decode arrives in Phase 1.2.

mod layers;
mod render;
mod text;

pub use layers::{blit_rgba_layer, LayerRgbaInput};
pub use render::{
    render_frame, render_frame_png, render_frame_with_layer_inputs, CompositorError,
};

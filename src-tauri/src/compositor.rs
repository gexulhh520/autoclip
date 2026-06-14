use autoclip_compositor::render_frame_png;
use autoclip_document::FrameDescriptor;
use base64::{engine::general_purpose::STANDARD, Engine as _};

#[tauri::command]
pub fn render_frame_png(descriptor_json: String) -> Result<String, String> {
    let descriptor: FrameDescriptor =
        serde_json::from_str(&descriptor_json).map_err(|error| error.to_string())?;
    let png = render_frame_png(&descriptor).map_err(|error| error.to_string())?;
    Ok(STANDARD.encode(png))
}

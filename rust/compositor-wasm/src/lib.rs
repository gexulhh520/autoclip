use autoclip_compositor::{render_frame_with_layer_inputs, LayerRgbaInput};
use autoclip_document::FrameDescriptor;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerRgbaPayload {
    block_id: String,
    width: u32,
    height: u32,
    rgba_b64: String,
}

fn decode_layers(layers_json: &str) -> Result<Vec<LayerRgbaInput>, String> {
    let payloads: Vec<LayerRgbaPayload> =
        serde_json::from_str(layers_json).map_err(|error| error.to_string())?;
    let mut layers = Vec::with_capacity(payloads.len());
    for payload in payloads {
        use base64::Engine;
        let rgba = base64::engine::general_purpose::STANDARD
            .decode(payload.rgba_b64)
            .map_err(|error| error.to_string())?;
        let expected = (payload.width as usize)
            .saturating_mul(payload.height as usize)
            .saturating_mul(4);
        if rgba.len() != expected {
            return Err(format!(
                "layer {} rgba size mismatch: expected {}, got {}",
                payload.block_id,
                expected,
                rgba.len()
            ));
        }
        layers.push(LayerRgbaInput {
            block_id: payload.block_id,
            width: payload.width,
            height: payload.height,
            rgba,
        });
    }
    Ok(layers)
}

/// 合成单帧：视频 RGBA 层 + 场景滤镜；返回 RGBA8（width * height * 4）。
#[wasm_bindgen(js_name = compositeVideoFrame)]
pub fn composite_video_frame(descriptor_json: &str, layers_json: &str) -> Result<Vec<u8>, JsValue> {
    let descriptor: FrameDescriptor =
        serde_json::from_str(descriptor_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
    let layers = decode_layers(layers_json).map_err(|error| JsValue::from_str(&error))?;
    render_frame_with_layer_inputs(&descriptor, &layers).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = isWasmCompositorAvailable)]
pub fn is_wasm_compositor_available() -> bool {
    true
}

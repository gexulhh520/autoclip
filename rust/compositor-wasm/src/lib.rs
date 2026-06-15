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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerRgbaMeta {
    block_id: String,
    width: u32,
    height: u32,
    byte_length: usize,
}

fn decode_layers_b64(layers_json: &str) -> Result<Vec<LayerRgbaInput>, String> {
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

fn decode_layers_binary(metas_json: &str, blob: &[u8]) -> Result<Vec<LayerRgbaInput>, String> {
    let metas: Vec<LayerRgbaMeta> = serde_json::from_str(metas_json).map_err(|error| error.to_string())?;
    let mut layers = Vec::with_capacity(metas.len());
    let mut offset = 0usize;
    for meta in metas {
        let end = offset
            .checked_add(meta.byte_length)
            .ok_or_else(|| "layer rgba offset overflow".to_string())?;
        if end > blob.len() {
            return Err(format!(
                "layer {} rgba blob truncated: need {} bytes, have {}",
                meta.block_id,
                end,
                blob.len()
            ));
        }
        let rgba = blob[offset..end].to_vec();
        offset = end;
        let expected = (meta.width as usize)
            .saturating_mul(meta.height as usize)
            .saturating_mul(4);
        if rgba.len() != expected {
            return Err(format!(
                "layer {} rgba size mismatch: expected {}, got {}",
                meta.block_id,
                expected,
                rgba.len()
            ));
        }
        layers.push(LayerRgbaInput {
            block_id: meta.block_id,
            width: meta.width,
            height: meta.height,
            rgba,
        });
    }
    Ok(layers)
}

fn composite_internal(
    descriptor_json: &str,
    layers: &[LayerRgbaInput],
) -> Result<Vec<u8>, JsValue> {
    let descriptor: FrameDescriptor =
        serde_json::from_str(descriptor_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
    render_frame_with_layer_inputs(&descriptor, layers).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// 合成单帧（base64 层，兼容旧接口）
#[wasm_bindgen(js_name = compositeVideoFrame)]
pub fn composite_video_frame(descriptor_json: &str, layers_json: &str) -> Result<Vec<u8>, JsValue> {
    let layers = decode_layers_b64(layers_json).map_err(|e| JsValue::from_str(&e))?;
    composite_internal(descriptor_json, &layers)
}

/// 合成单帧（二进制 RGBA blob，导出推荐）
#[wasm_bindgen(js_name = compositeVideoFrameBinary)]
pub fn composite_video_frame_binary(
    descriptor_json: &str,
    layers_meta_json: &str,
    rgba_blob: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let layers = decode_layers_binary(layers_meta_json, rgba_blob).map_err(|e| JsValue::from_str(&e))?;
    composite_internal(descriptor_json, &layers)
}

#[wasm_bindgen(js_name = isWasmCompositorAvailable)]
pub fn is_wasm_compositor_available() -> bool {
    true
}

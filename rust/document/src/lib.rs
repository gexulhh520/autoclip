//! CompositionPlan / FrameDescriptor — TS ↔ Rust round-trip types.

use serde::{Deserialize, Serialize};

pub const COMPOSITOR_SCHEMA_VERSION: &str = "compositor-1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisualTransform {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionCanvas {
    pub width: u32,
    pub height: u32,
    pub aspect: String,
    pub fit_mode: String,
    pub visual_filter: String,
    pub fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CompositionLayerDef {
    #[serde(rename_all = "camelCase")]
    VideoClip {
        block_id: String,
        block_index: u32,
        media_path: String,
        trim_in_sec: f64,
        trim_out_sec: f64,
        playback_rate: f64,
        composition_start_sec: f64,
        source_duration_sec: f64,
        transition_out: String,
        dissolve_out_sec: f64,
        volume: f64,
        fade_in_sec: f64,
        fade_out_sec: f64,
    },
    #[serde(rename_all = "camelCase")]
    TemplateCaption {
        block_id: String,
        block_index: u32,
        composition_start_sec: f64,
        source_duration_sec: f64,
        layout: String,
        applicable: bool,
        layers: Vec<TemplateCaptionPreviewLayer>,
        config: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    FreeText {
        element_id: String,
        track_id: String,
        start_sec: f64,
        duration_sec: f64,
        hidden: bool,
        params: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    AudioBgm {
        path: String,
        volume: f64,
        start_sec: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        end_sec: Option<f64>,
        duck_enabled: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        duck_ratio: Option<f64>,
        fade_in_sec: f64,
        fade_out_sec: f64,
    },
    #[serde(rename_all = "camelCase")]
    Filter {
        filter_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Transition {
        transition_duration_sec: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TemplateCaptionPreviewLayer {
    pub role: String,
    pub text: String,
    pub color: String,
    pub size_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionPlanCompileOptions {
    pub burn_subtitles: bool,
    pub use_source_video: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionPlanMetadata {
    pub compiled_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionTimeline {
    pub segments: Vec<serde_json::Value>,
    pub total_duration_sec: f64,
    pub transition_duration_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionPlan {
    pub schema_version: String,
    pub session_id: String,
    pub project_id: String,
    pub canvas: CompositionCanvas,
    pub timeline: CompositionTimeline,
    pub total_duration_sec: f64,
    pub transition_duration_sec: f64,
    pub layers: Vec<CompositionLayerDef>,
    pub compile: CompositionPlanCompileOptions,
    pub metadata: CompositionPlanMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameTextLine {
    pub role: String,
    pub text: String,
    pub color: String,
    pub size_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameTextAnchor {
    pub bottom_pct: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_x: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameOffsetPct {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FrameItem {
    #[serde(rename_all = "camelCase")]
    Layer {
        id: String,
        source: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        block_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        relative_source_sec: Option<f64>,
        transform: VisualTransform,
        opacity: f64,
        z_index: i32,
    },
    #[serde(rename_all = "camelCase")]
    Text {
        id: String,
        source: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        block_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        layout: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        lines: Option<Vec<FrameTextLine>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        anchor: Option<FrameTextAnchor>,
        #[serde(skip_serializing_if = "Option::is_none")]
        offset_pct: Option<FrameOffsetPct>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transform: Option<VisualTransform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        params: Option<serde_json::Value>,
        opacity: f64,
        z_index: i32,
    },
    #[serde(rename_all = "camelCase")]
    EffectGroup {
        id: String,
        effect_ids: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SceneEffect {
        id: String,
        effect_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameClearColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub schema_version: String,
    pub time_sec: f64,
    pub width: u32,
    pub height: u32,
    pub clear: FrameClearColor,
    pub items: Vec<FrameItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_descriptor_roundtrip_minimal() {
        let json = r#"{
          "schema_version": "compositor-1",
          "timeSec": 0,
          "width": 608,
          "height": 1080,
          "clear": { "r": 0, "g": 0, "b": 0, "a": 1 },
          "items": [{
            "kind": "layer",
            "id": "video:a",
            "source": "video",
            "blockId": "a",
            "relativeSourceSec": 0,
            "transform": { "x": 0, "y": 120, "width": 608, "height": 840 },
            "opacity": 1,
            "zIndex": 0
          }],
          "transition": { "inDissolve": false, "progress": null }
        }"#;

        let parsed: FrameDescriptor = serde_json::from_str(json).expect("deserialize TS-shaped JSON");
        assert_eq!(parsed.schema_version, COMPOSITOR_SCHEMA_VERSION);
        assert_eq!(parsed.width, 608);
        assert_eq!(parsed.items.len(), 1);

        let reserialized = serde_json::to_string(&parsed).expect("serialize");
        let again: FrameDescriptor = serde_json::from_str(&reserialized).expect("round-trip");
        assert_eq!(again, parsed);
    }
}

use autoclip_document::{FrameDescriptor, FrameItem};
use image::{ImageEncoder, Rgba, RgbaImage};

use crate::text::draw_text_item;

#[derive(Debug)]
pub enum CompositorError {
    InvalidDescriptor(String),
    PngEncode(String),
}

impl std::fmt::Display for CompositorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDescriptor(message) => write!(f, "invalid descriptor: {message}"),
            Self::PngEncode(message) => write!(f, "png encode failed: {message}"),
        }
    }
}

impl std::error::Error for CompositorError {}

fn sort_key(item: &FrameItem) -> (i32, u8) {
    match item {
        FrameItem::Layer { z_index, .. } => (*z_index, 0),
        FrameItem::Text { z_index, .. } => (*z_index, 1),
        FrameItem::EffectGroup { .. } => (i32::MAX - 1, 2),
        FrameItem::SceneEffect { .. } => (i32::MAX, 3),
    }
}

fn clear_color(descriptor: &FrameDescriptor) -> Rgba<u8> {
    let c = &descriptor.clear;
    Rgba([
        (c.r.clamp(0.0, 1.0) * 255.0) as u8,
        (c.g.clamp(0.0, 1.0) * 255.0) as u8,
        (c.b.clamp(0.0, 1.0) * 255.0) as u8,
        (c.a.clamp(0.0, 1.0) * 255.0) as u8,
    ])
}

fn blend_pixel(dst: &mut Rgba<u8>, src: Rgba<u8>, opacity: f32) {
    let alpha = (src[3] as f32 / 255.0) * opacity.clamp(0.0, 1.0);
    if alpha <= 0.0 {
        return;
    }
    let inv = 1.0 - alpha;
    for i in 0..3 {
        dst[i] = ((dst[i] as f32 * inv) + (src[i] as f32 * alpha)).round() as u8;
    }
    dst[3] = ((dst[3] as f32 * inv) + (255.0 * alpha)).round() as u8;
}

fn draw_layer_rect(img: &mut RgbaImage, transform: &autoclip_document::VisualTransform, opacity: f64, tint: Rgba<u8>) {
    let width = img.width() as f64;
    let height = img.height() as f64;
    let x0 = transform.x.max(0.0).floor() as u32;
    let y0 = transform.y.max(0.0).floor() as u32;
    let x1 = (transform.x + transform.width).min(width).ceil() as u32;
    let y1 = (transform.y + transform.height).min(height).ceil() as u32;
    let op = opacity as f32;

    for y in y0..y1 {
        for x in x0..x1 {
            if let Some(pixel) = img.get_pixel_mut_checked(x, y) {
                blend_pixel(pixel, tint, op);
            }
        }
    }
}

fn layer_tint(source: &str) -> Rgba<u8> {
    match source {
        "blur_backdrop" => Rgba([32, 32, 40, 255]),
        _ => Rgba([48, 48, 56, 255]),
    }
}

fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

fn apply_brightness(r: f32, g: f32, b: f32, amount: f32) -> (f32, f32, f32) {
    (clamp01(r * amount), clamp01(g * amount), clamp01(b * amount))
}

fn apply_contrast(r: f32, g: f32, b: f32, amount: f32) -> (f32, f32, f32) {
    (
        clamp01((r - 0.5) * amount + 0.5),
        clamp01((g - 0.5) * amount + 0.5),
        clamp01((b - 0.5) * amount + 0.5),
    )
}

fn apply_saturate(r: f32, g: f32, b: f32, amount: f32) -> (f32, f32, f32) {
    let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    (
        clamp01(luma + amount * (r - luma)),
        clamp01(luma + amount * (g - luma)),
        clamp01(luma + amount * (b - luma)),
    )
}

fn apply_css_filter(r: f32, g: f32, b: f32, filter: &str) -> (f32, f32, f32) {
    match filter {
        "mono_soft" => {
            let (r, g, b) = apply_brightness(r, g, b, 1.02);
            let (r, g, b) = apply_saturate(r, g, b, 0.65);
            apply_contrast(r, g, b, 1.05)
        }
        "mono_contrast" => {
            let (r, g, b) = apply_contrast(r, g, b, 1.18);
            let (r, g, b) = apply_brightness(r, g, b, 0.97);
            apply_saturate(r, g, b, 0.55)
        }
        "mono_cool" => {
            let (r, g, b) = apply_saturate(r, g, b, 0.5);
            apply_brightness(r, g, b, 1.01)
        }
        "mono_warm" => {
            let (r, g, b) = apply_saturate(r, g, b, 0.62);
            let (r, g, b) = apply_brightness(r, g, b, 1.03);
            apply_contrast(r, g, b, 1.06)
        }
        _ => (r, g, b),
    }
}

fn apply_scene_effect(img: &mut RgbaImage, effect_id: &str) {
    if !effect_id.starts_with("visual_filter.") {
        return;
    }
    let filter = effect_id.trim_start_matches("visual_filter.");
    if filter == "none" {
        return;
    }
    for pixel in img.pixels_mut() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;
        let (nr, ng, nb) = apply_css_filter(r, g, b, filter);
        pixel[0] = (nr * 255.0).round() as u8;
        pixel[1] = (ng * 255.0).round() as u8;
        pixel[2] = (nb * 255.0).round() as u8;
    }
}

/// Render a single frame to RGBA8 bytes (width * height * 4).
pub fn render_frame(descriptor: &FrameDescriptor) -> Result<Vec<u8>, CompositorError> {
    if descriptor.width == 0 || descriptor.height == 0 {
        return Err(CompositorError::InvalidDescriptor(
            "width/height must be > 0".into(),
        ));
    }

    let mut img = RgbaImage::from_pixel(descriptor.width, descriptor.height, clear_color(descriptor));

    let mut items: Vec<&FrameItem> = descriptor.items.iter().collect();
    items.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));

    for item in items {
        match item {
            FrameItem::Layer {
                source,
                transform,
                opacity,
                ..
            } => {
                draw_layer_rect(&mut img, transform, *opacity, layer_tint(source));
            }
            FrameItem::Text { opacity, .. } => {
                draw_text_item(&mut img, item, *opacity);
            }
            FrameItem::SceneEffect { effect_id, .. } => {
                apply_scene_effect(&mut img, effect_id);
            }
            FrameItem::EffectGroup { .. } => {}
        }
    }

    Ok(img.into_raw())
}

/// Render frame and encode as PNG bytes.
pub fn render_frame_png(descriptor: &FrameDescriptor) -> Result<Vec<u8>, CompositorError> {
    let rgba = render_frame(descriptor)?;
    let img = RgbaImage::from_raw(descriptor.width, descriptor.height, rgba).ok_or_else(|| {
        CompositorError::InvalidDescriptor("failed to rebuild image buffer".into())
    })?;
    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(
            img.as_raw(),
            descriptor.width,
            descriptor.height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| CompositorError::PngEncode(error.to_string()))?;
    Ok(png_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use autoclip_document::{FrameClearColor, FrameDescriptor, VisualTransform};

    #[test]
    fn renders_clear_frame() {
        let descriptor = FrameDescriptor {
            schema_version: autoclip_document::COMPOSITOR_SCHEMA_VERSION.to_string(),
            time_sec: 0.0,
            width: 64,
            height: 64,
            clear: FrameClearColor {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
            items: vec![],
            audio: None,
            transition: None,
        };
        let rgba = render_frame(&descriptor).expect("render");
        assert_eq!(rgba.len(), 64 * 64 * 4);
        assert_eq!(rgba[0], 0);
        assert_eq!(rgba[3], 255);
    }

    #[test]
    fn renders_layer_rect_with_opacity() {
        let descriptor = FrameDescriptor {
            schema_version: autoclip_document::COMPOSITOR_SCHEMA_VERSION.to_string(),
            time_sec: 0.0,
            width: 100,
            height: 100,
            clear: FrameClearColor {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
            items: vec![FrameItem::Layer {
                id: "video:a".into(),
                source: "video".into(),
                block_id: Some("a".into()),
                relative_source_sec: Some(0.0),
                transform: VisualTransform {
                    x: 10.0,
                    y: 10.0,
                    width: 80.0,
                    height: 80.0,
                    rotation: None,
                    scale_x: None,
                    scale_y: None,
                },
                opacity: 1.0,
                z_index: 0,
            }],
            audio: None,
            transition: None,
        };
        let rgba = render_frame(&descriptor).expect("render");
        let center = &rgba[(50 * 100 + 50) * 4..(50 * 100 + 50) * 4 + 4];
        assert!(center[0] > 0);
    }

    #[test]
    fn png_roundtrip() {
        let descriptor = FrameDescriptor {
            schema_version: autoclip_document::COMPOSITOR_SCHEMA_VERSION.to_string(),
            time_sec: 0.0,
            width: 8,
            height: 8,
            clear: FrameClearColor {
                r: 0.1,
                g: 0.1,
                b: 0.1,
                a: 1.0,
            },
            items: vec![],
            audio: None,
            transition: None,
        };
        let png = render_frame_png(&descriptor).expect("png");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
    }
}

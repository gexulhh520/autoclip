use autoclip_document::VisualTransform;
use image::{Rgba, RgbaImage};

#[derive(Debug, Clone)]
pub struct LayerRgbaInput {
    pub block_id: String,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
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

fn sample_rgba(src: &[u8], src_w: u32, src_h: u32, x: u32, y: u32) -> Rgba<u8> {
    let sx = x.min(src_w.saturating_sub(1));
    let sy = y.min(src_h.saturating_sub(1));
    let idx = ((sy * src_w + sx) * 4) as usize;
    if idx + 3 >= src.len() {
        return Rgba([0, 0, 0, 0]);
    }
    Rgba([src[idx], src[idx + 1], src[idx + 2], src[idx + 3]])
}

/// 将解码后的 RGBA 视频帧按 transform 绘制到目标画布（最近邻缩放）。
pub fn blit_rgba_layer(
    img: &mut RgbaImage,
    src: &[u8],
    src_w: u32,
    src_h: u32,
    transform: &VisualTransform,
    opacity: f64,
) {
    if src_w == 0 || src_h == 0 || src.is_empty() {
        return;
    }

    let dest_w = transform.width.max(1.0);
    let dest_h = transform.height.max(1.0);
    let x0 = transform.x.floor() as i32;
    let y0 = transform.y.floor() as i32;
    let op = opacity as f32;

    for dy in 0..dest_h.ceil() as u32 {
        for dx in 0..dest_w.ceil() as u32 {
            let dest_x = x0 + dx as i32;
            let dest_y = y0 + dy as i32;
            if dest_x < 0 || dest_y < 0 {
                continue;
            }
            let dest_x = dest_x as u32;
            let dest_y = dest_y as u32;
            let sx = ((dx as f64 / dest_w) * src_w as f64).floor() as u32;
            let sy = ((dy as f64 / dest_h) * src_h as f64).floor() as u32;
            let pixel = sample_rgba(src, src_w, src_h, sx, sy);
            if let Some(dst) = img.get_pixel_mut_checked(dest_x, dest_y) {
                blend_pixel(dst, pixel, op);
            }
        }
    }
}

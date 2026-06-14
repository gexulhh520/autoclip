use autoclip_document::{FrameItem, FrameTextLine};
use image::{Rgba, RgbaImage};

fn parse_hex_color(color: &str) -> Rgba<u8> {
    let trimmed = color.trim().trim_start_matches('#');
    if trimmed.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&trimmed[0..2], 16),
            u8::from_str_radix(&trimmed[2..4], 16),
            u8::from_str_radix(&trimmed[4..6], 16),
        ) {
            return Rgba([r, g, b, 255]);
        }
    }
    Rgba([255, 255, 255, 255])
}

fn estimate_line_width(text: &str, font_size: f32) -> u32 {
    ((text.chars().count() as f32) * font_size * 0.55).ceil() as u32
}

fn draw_text_line_block(
    img: &mut RgbaImage,
    x: i32,
    y: i32,
    text: &str,
    font_size: f32,
    color: Rgba<u8>,
    opacity: f32,
) {
    let width = estimate_line_width(text, font_size).max(1);
    let height = (font_size * 1.35).ceil() as u32;
    for dy in 0..height {
        for dx in 0..width {
            let px = x + dx as i32;
            let py = y + dy as i32;
            if px < 0 || py < 0 {
                continue;
            }
            let px = px as u32;
            let py = py as u32;
            if let Some(pixel) = img.get_pixel_mut_checked(px, py) {
                let alpha = opacity * (color[3] as f32 / 255.0);
                let inv = 1.0 - alpha;
                for i in 0..3 {
                    pixel[i] = ((pixel[i] as f32 * inv) + (color[i] as f32 * alpha)).round() as u8;
                }
                pixel[3] = ((pixel[3] as f32 * inv) + (255.0 * alpha)).round() as u8;
            }
        }
    }
}

fn draw_template_lines(
    img: &mut RgbaImage,
    lines: &[FrameTextLine],
    anchor: &autoclip_document::FrameTextAnchor,
    offset_pct: Option<&autoclip_document::FrameOffsetPct>,
    opacity: f64,
) {
    let canvas_w = img.width() as f64;
    let canvas_h = img.height() as f64;
    let base_font = (canvas_h * 0.048).max(14.0);
    let bottom = canvas_h * (anchor.bottom_pct / 100.0);
    let offset_x = offset_pct.map(|v| canvas_w * (v.x / 100.0)).unwrap_or(0.0);
    let offset_y = offset_pct.map(|v| canvas_h * (v.y / 100.0)).unwrap_or(0.0);

    let mut total_height = 0.0;
    for line in lines {
        total_height += base_font * line.size_scale * 1.35;
    }

    let mut cursor_y = canvas_h - bottom - total_height - offset_y;
    for line in lines {
        let font_size = (base_font * line.size_scale) as f32;
        let line_width = estimate_line_width(&line.text, font_size) as f64;
        let x = if anchor.center_x.unwrap_or(false) {
            (canvas_w - line_width) / 2.0 + offset_x
        } else if let Some(right) = anchor.right_pct {
            canvas_w - canvas_w * (right / 100.0) - line_width + offset_x
        } else {
            canvas_w * (anchor.left_pct.unwrap_or(5.5) / 100.0) + offset_x
        };
        draw_text_line_block(
            img,
            x.round() as i32,
            cursor_y.round() as i32,
            &line.text,
            font_size,
            parse_hex_color(&line.color),
            opacity as f32,
        );
        cursor_y += font_size as f64 * 1.35;
    }
}

pub fn draw_text_item(img: &mut RgbaImage, item: &FrameItem, opacity: f64) {
    let FrameItem::Text {
        lines,
        anchor,
        offset_pct,
        layout,
        ..
    } = item
    else {
        return;
    };

    if layout.as_deref() == Some("none") {
        return;
    }

    let Some(lines) = lines else { return };
    if lines.is_empty() {
        return;
    }

    if let Some(anchor) = anchor {
        draw_template_lines(img, lines, anchor, offset_pct.as_ref(), opacity);
    }
}

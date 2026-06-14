use std::process::Command;
use std::sync::OnceLock;

fn resolve_ffmpeg_path() -> String {
    std::env::var("AUTOCLIP_FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string())
}

static HARDWARE_CODEC: OnceLock<Option<String>> = OnceLock::new();

fn probe_hardware_codec() -> Option<String> {
    let ffmpeg = resolve_ffmpeg_path();
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for candidate in ["h264_videotoolbox", "h264_nvenc", "h264_amf", "h264_qsv"] {
        if text.contains(candidate) {
            return Some(candidate.to_string());
        }
    }
    None
}

/// 解析视频编码器：默认优先硬件 H.264，不可用则 libx264。
pub fn resolve_video_codec(prefer_hardware: bool) -> String {
    if let Ok(forced) = std::env::var("AUTOCLIP_VIDEO_CODEC") {
        let trimmed = forced.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if !prefer_hardware {
        return "libx264".to_string();
    }
    HARDWARE_CODEC
        .get_or_init(probe_hardware_codec)
        .clone()
        .unwrap_or_else(|| "libx264".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn software_fallback_when_hardware_disabled() {
        assert_eq!(resolve_video_codec(false), "libx264");
    }
}

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

#[derive(Debug)]
pub enum EncoderError {
    Io(String),
    Ffmpeg(String),
    InvalidSize,
}

impl std::fmt::Display for EncoderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) => write!(f, "io error: {message}"),
            Self::Ffmpeg(message) => write!(f, "ffmpeg error: {message}"),
            Self::InvalidSize => write!(f, "invalid frame size"),
        }
    }
}

impl std::error::Error for EncoderError {}

fn resolve_ffmpeg_path() -> String {
    std::env::var("AUTOCLIP_FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string())
}

/// FFmpeg stdin rawvideo → H.264 MP4（无 filtergraph 布局）
pub struct FfmpegStdinEncoder {
    child: Child,
    width: u32,
    height: u32,
    frame_bytes: usize,
    output_path: PathBuf,
}

impl FfmpegStdinEncoder {
    pub fn start(
        output_path: impl AsRef<Path>,
        width: u32,
        height: u32,
        fps: f64,
    ) -> Result<Self, EncoderError> {
        if width == 0 || height == 0 {
            return Err(EncoderError::InvalidSize);
        }
        let output_path = output_path.as_ref().to_path_buf();
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| EncoderError::Io(error.to_string()))?;
        }

        let fps_text = format!("{fps:.3}");
        let size = format!("{width}x{height}");
        let ffmpeg = resolve_ffmpeg_path();
        let child = Command::new(ffmpeg)
            .args([
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                &size,
                "-r",
                &fps_text,
                "-i",
                "pipe:0",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-movflags",
                "+faststart",
            ])
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| EncoderError::Ffmpeg(error.to_string()))?;

        Ok(Self {
            child,
            width,
            height,
            frame_bytes: (width as usize) * (height as usize) * 4,
            output_path,
        })
    }

    pub fn write_frame(&mut self, rgba: &[u8]) -> Result<(), EncoderError> {
        if rgba.len() != self.frame_bytes {
            return Err(EncoderError::InvalidSize);
        }
        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| EncoderError::Io("encoder stdin closed".into()))?;
        stdin
            .write_all(rgba)
            .map_err(|error| EncoderError::Io(error.to_string()))?;
        Ok(())
    }

    pub fn finish(mut self) -> Result<PathBuf, EncoderError> {
        if let Some(stdin) = self.child.stdin.take() {
            drop(stdin);
        }
        let output = self
            .child
            .wait_with_output()
            .map_err(|error| EncoderError::Ffmpeg(error.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(EncoderError::Ffmpeg(stderr.chars().take(500).collect()));
        }
        if !self.output_path.is_file() {
            return Err(EncoderError::Ffmpeg("encoder produced no output file".into()));
        }
        Ok(self.output_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn starts_only_when_ffmpeg_available() {
        if Command::new(resolve_ffmpeg_path())
            .arg("-version")
            .output()
            .is_err()
        {
            return;
        }
        let dir = env::temp_dir().join("autoclip-encoder-test");
        let _ = std::fs::create_dir_all(&dir);
        let output = dir.join("test.mp4");
        let mut encoder = FfmpegStdinEncoder::start(&output, 16, 16, 30.0).expect("start");
        let frame = vec![0u8; 16 * 16 * 4];
        encoder.write_frame(&frame).expect("frame");
        let path = encoder.finish().expect("finish");
        assert!(path.is_file());
        let _ = std::fs::remove_dir_all(dir);
    }
}

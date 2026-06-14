use autoclip_encoder::FfmpegStdinEncoder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug)]
pub enum ExportError {
    NotFound,
    InvalidFrame,
    Encoder(String),
    Io(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "export session not found"),
            Self::InvalidFrame => write!(f, "invalid frame payload"),
            Self::Encoder(message) => write!(f, "encoder: {message}"),
            Self::Io(message) => write!(f, "io: {message}"),
        }
    }
}

impl std::error::Error for ExportError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStartOptions {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub total_frames: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFinishOptions {
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub session_id: String,
    pub frame: u32,
    pub total_frames: u32,
    pub percent: u8,
    pub message: String,
}

struct ActiveExport {
    encoder: FfmpegStdinEncoder,
    total_frames: u32,
    frames_written: u32,
    output_path: PathBuf,
}

pub struct ExportSessionManager {
    sessions: Mutex<HashMap<String, ActiveExport>>,
}

impl Default for ExportSessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl ExportSessionManager {
    pub fn start(&self, options: ExportStartOptions) -> Result<(String, ExportProgress), ExportError> {
        let encoder = FfmpegStdinEncoder::start(
            &options.output_path,
            options.width,
            options.height,
            options.fps,
        )
        .map_err(|error| ExportError::Encoder(error.to_string()))?;

        let session_id = Uuid::new_v4().to_string();
        let progress = ExportProgress {
            session_id: session_id.clone(),
            frame: 0,
            total_frames: options.total_frames,
            percent: 0,
            message: "开始编码".into(),
        };

        self.sessions.lock().unwrap().insert(
            session_id.clone(),
            ActiveExport {
                encoder,
                total_frames: options.total_frames,
                frames_written: 0,
                output_path: PathBuf::from(options.output_path),
            },
        );

        Ok((session_id, progress))
    }

    pub fn push_frame(
        &self,
        session_id: &str,
        rgba: &[u8],
    ) -> Result<ExportProgress, ExportError> {
        let mut sessions = self.sessions.lock().unwrap();
        let active = sessions.get_mut(session_id).ok_or(ExportError::NotFound)?;
        active
            .encoder
            .write_frame(rgba)
            .map_err(|error| ExportError::Encoder(error.to_string()))?;
        active.frames_written += 1;
        let percent = if active.total_frames == 0 {
            100
        } else {
            ((active.frames_written as f64 / active.total_frames as f64) * 100.0).round() as u8
        };
        Ok(ExportProgress {
            session_id: session_id.to_string(),
            frame: active.frames_written,
            total_frames: active.total_frames,
            percent: percent.min(99),
            message: format!("编码帧 {}/{}", active.frames_written, active.total_frames),
        })
    }

    pub fn finish(
        &self,
        session_id: &str,
        _options: ExportFinishOptions,
    ) -> Result<(PathBuf, ExportProgress), ExportError> {
        let active = self
            .sessions
            .lock()
            .unwrap()
            .remove(session_id)
            .ok_or(ExportError::NotFound)?;
        let path = active
            .encoder
            .finish()
            .map_err(|error| ExportError::Encoder(error.to_string()))?;
        let progress = ExportProgress {
            session_id: session_id.to_string(),
            frame: active.frames_written,
            total_frames: active.total_frames,
            percent: 100,
            message: "视频编码完成".into(),
        };
        Ok((path, progress))
    }

    pub fn cancel(&self, session_id: &str) -> Result<(), ExportError> {
        self.sessions.lock().unwrap().remove(session_id);
        Ok(())
    }
}

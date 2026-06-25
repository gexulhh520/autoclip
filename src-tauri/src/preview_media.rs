//! 桌面端预览媒体：`video` 自定义协议，本地文件 Range 流式读取（scrub + 连续播放统一路径）。

use http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
};
use http::{Method, StatusCode};
use http_range::HttpRange;
use percent_encoding::percent_decode_str;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::http::{Request, Response};

const MAX_RANGE_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_data_dir(path: PathBuf) {
    let _ = DATA_DIR.set(path);
}

fn data_dir() -> PathBuf {
    DATA_DIR
        .get()
        .cloned()
        .or_else(|| std::env::var("AUTOCLIP_DATA_DIR").ok().map(PathBuf::from))
        .or_else(load_persisted_data_dir)
        .unwrap_or_else(default_dev_data_dir)
}

fn load_persisted_data_dir() -> Option<PathBuf> {
    let path = bootstrap_paths_file()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value
        .get("data_dir")
        .and_then(|item| item.as_str())
        .map(PathBuf::from)
}

fn bootstrap_paths_file() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|dir| PathBuf::from(dir).join("AutoClip").join("app_paths.json"))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME").ok().map(|dir| {
            PathBuf::from(dir)
                .join("Library")
                .join("Application Support")
                .join("AutoClip")
                .join("app_paths.json")
        })
    } else {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(|dir| PathBuf::from(dir).join("AutoClip").join("app_paths.json"))
            .or_else(|| {
                std::env::var("HOME").ok().map(|dir| {
                    PathBuf::from(dir)
                        .join(".local")
                        .join("share")
                        .join("AutoClip")
                        .join("app_paths.json")
                })
            })
    }
}

fn default_dev_data_dir() -> PathBuf {
    // 开发态 fallback：仓库 data/
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
}

fn projects_dir() -> PathBuf {
    data_dir().join("projects")
}

fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(project_id) {
        return Err("invalid project id".into());
    }
    Ok(projects_dir().join(project_id))
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains('/')
        && !id.contains('\\')
        && id != "."
        && id != ".."
}

fn resolve_under_project(project_dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    let candidate = if Path::new(&rel).is_absolute() {
        PathBuf::from(&rel)
    } else {
        project_dir.join(&rel)
    };
  let canonical = candidate
        .canonicalize()
        .map_err(|_| format!("media not found: {}", rel))?;
    let project_canonical = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    if !canonical.starts_with(&project_canonical) {
        return Err("media path outside project".into());
    }
    Ok(canonical)
}

fn read_session_json(project_dir: &Path, session_id: &str) -> Result<serde_json::Value, String> {
    if !is_safe_id(session_id) {
        return Err("invalid session id".into());
    }
    let path = project_dir
        .join("edit_sessions")
        .join(format!("{}.json", session_id));
    let text = std::fs::read_to_string(&path).map_err(|_| "session not found".to_string())?;
    serde_json::from_str(&text).map_err(|_| "session json invalid".to_string())
}

fn resolve_block_media_path(
    project_id: &str,
    session_id: &str,
    block_id: &str,
) -> Result<PathBuf, String> {
    if !is_safe_id(block_id) {
        return Err("invalid block id".into());
    }
    let project_dir = project_dir(project_id)?;
    let session = read_session_json(&project_dir, session_id)?;
    let sequence = session
        .get("sequence")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "session sequence missing".to_string())?;
    let block = sequence
        .iter()
        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(block_id))
        .ok_or_else(|| "block not found".to_string())?;
    let media_path = block
        .get("media")
        .and_then(|m| m.get("path"))
        .and_then(|p| p.as_str())
        .ok_or_else(|| "block media path missing".to_string())?;
    resolve_under_project(&project_dir, media_path)
}

fn resolve_audio_asset_path(
    project_id: &str,
    session_id: &str,
    asset_id: &str,
) -> Result<PathBuf, String> {
    if !is_safe_id(asset_id) {
        return Err("invalid asset id".into());
    }
    let project_dir = project_dir(project_id)?;
    let session = read_session_json(&project_dir, session_id)?;
    let assets = session
        .get("audio_assets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "audio_assets missing".to_string())?;
    for asset in assets {
        if asset.get("id").and_then(|v| v.as_str()) == Some(asset_id) {
            let rel = asset
                .get("path")
                .and_then(|p| p.as_str())
                .ok_or_else(|| "audio path missing".to_string())?;
            return resolve_under_project(&project_dir, rel);
        }
    }
    if asset_id.starts_with("legacy-") {
        let legacy = session
            .get("audio_settings")
            .and_then(|s| s.get("bgm_path"))
            .and_then(|p| p.as_str());
        if let Some(rel) = legacy {
            return resolve_under_project(&project_dir, rel);
        }
    }
    Err("audio asset not found".to_string())
}

fn resolve_source_video_path(project_id: &str, source_id: Option<&str>) -> Result<PathBuf, String> {
    let project_dir = project_dir(project_id)?;
    if let Some(id) = source_id {
        if !is_safe_id(id) {
            return Err("invalid source id".into());
        }
        let path = project_dir
            .join("metadata")
            .join("sources")
            .join(id)
            .join("input.mp4");
        if path.exists() {
            return Ok(path.canonicalize().map_err(|e| e.to_string())?);
        }
        return Err("source video not found".to_string());
    }
    let default = project_dir.join("raw").join("input.mp4");
    if default.exists() {
        return Ok(default.canonicalize().map_err(|e| e.to_string())?);
    }
    Err("source video not found".to_string())
}

fn resolve_clip_path(project_id: &str, clip_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(clip_id) {
        return Err("invalid clip id".into());
    }
    let project_dir = project_dir(project_id)?;
    let clips_dir = project_dir.join("output").join("clips");
    if !clips_dir.is_dir() {
        return Err("clips dir missing".to_string());
    }
    // 精确文件名或 glob *{clip_id}*
    let direct = clips_dir.join(format!("{}.mp4", clip_id));
    if direct.is_file() {
        return Ok(direct.canonicalize().map_err(|e| e.to_string())?);
    }
    for entry in std::fs::read_dir(&clips_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains(clip_id) {
                return Ok(path.canonicalize().map_err(|e| e.to_string())?);
            }
        }
    }
    Err("clip not found".to_string())
}

fn decode_path_segments(path: &str) -> Vec<String> {
    path.trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|segment| percent_decode_str(segment).decode_utf8_lossy().into_owned())
        .collect()
}

fn resolve_media_path_from_uri(path: &str) -> Result<PathBuf, String> {
    let segments = decode_path_segments(path);
    if segments.len() == 4 && segments[0] == "block" {
        return resolve_block_media_path(&segments[1], &segments[2], &segments[3]);
    }
    if segments.len() == 2 && segments[0] == "source" {
        return resolve_source_video_path(&segments[1], None);
    }
    if segments.len() == 3 && segments[0] == "source" {
        return resolve_source_video_path(&segments[1], Some(&segments[2]));
    }
    if segments.len() == 4 && segments[0] == "audio" {
        return resolve_audio_asset_path(&segments[1], &segments[2], &segments[3]);
    }
    if segments.len() == 3 && segments[0] == "clip" {
        return resolve_clip_path(&segments[1], &segments[2]);
    }
    Err("unknown preview media route".to_string())
}

fn mime_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    }
}

fn random_boundary() -> String {
    format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos())
}

fn stream_file_response(
    request: &Request<Vec<u8>>,
    file_path: &Path,
) -> Result<Response<Vec<u8>>, String> {
    let mut file = File::open(file_path).map_err(|e| e.to_string())?;
    let len = {
        let old = file.stream_position().map_err(|e| e.to_string())?;
        let end = file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(old)).map_err(|e| e.to_string())?;
        end
    };
    let media_type = mime_for_path(file_path);
    let is_head = request.method() == Method::HEAD;

    let mut builder = Response::builder()
        .header(CONTENT_TYPE, media_type)
        .header(ACCEPT_RANGES, "bytes")
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    if let Some(range_header) = request.headers().get("range") {
        let ranges = HttpRange::parse(range_header.to_str().unwrap_or(""), len)
            .map_err(|_| "invalid range".to_string())?;
        let ranges: Vec<(u64, u64)> = ranges
            .iter()
            .map(|r| (r.start, r.start + r.length - 1))
            .collect();

        if ranges.len() == 1 {
            let (start, mut end) = ranges[0];
            if start >= len || end >= len || end < start {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(CONTENT_RANGE, format!("bytes */{}", len))
                    .body(Vec::new())
                    .map_err(|e| e.to_string());
            }
            end = start + (end - start).min(len - start).min(MAX_RANGE_CHUNK_BYTES - 1);
            let bytes_to_read = end + 1 - start;
            if is_head {
                return builder
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, len))
                    .header(CONTENT_LENGTH, bytes_to_read)
                    .body(Vec::new())
                    .map_err(|e| e.to_string());
            }
            let mut buf = Vec::with_capacity(bytes_to_read as usize);
            file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
            file.take(bytes_to_read).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, len))
                .header(CONTENT_LENGTH, bytes_to_read)
                .body(buf)
                .map_err(|e| e.to_string())
        } else {
            let boundary = random_boundary();
            let boundary_sep = format!("\r\n--{}\r\n", boundary);
            let boundary_closer = format!("\r\n--{}--\r\n", boundary);
            builder = builder.header(
                CONTENT_TYPE,
                format!("multipart/byteranges; boundary={}", boundary),
            );
            if is_head {
                return builder.body(Vec::new()).map_err(|e| e.to_string());
            }
            let mut buf = Vec::new();
            for (start, mut end) in ranges {
                if start >= len || end >= len || end < start {
                    continue;
                }
                end = start + (end - start).min(len - start).min(MAX_RANGE_CHUNK_BYTES - 1);
                buf.write_all(boundary_sep.as_bytes()).map_err(|e| e.to_string())?;
                buf.write_all(format!("{}: {}\r\n", CONTENT_TYPE, media_type).as_bytes())
                    .map_err(|e| e.to_string())?;
                buf.write_all(
                    format!("{}: bytes {}-{}/{}\r\n\r\n", CONTENT_RANGE, start, end, len).as_bytes(),
                )
                .map_err(|e| e.to_string())?;
                let bytes_to_read = end + 1 - start;
                let mut local = vec![0_u8; bytes_to_read as usize];
                file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
                file.read_exact(&mut local).map_err(|e| e.to_string())?;
                buf.extend_from_slice(&local);
            }
            buf.write_all(boundary_closer.as_bytes()).map_err(|e| e.to_string())?;
            builder.body(buf).map_err(|e| e.to_string())
        }
    } else {
        if is_head {
            return builder
                .header(CONTENT_LENGTH, len)
                .body(Vec::new())
                .map_err(|e| e.to_string());
        }
        let mut buf = Vec::with_capacity(len as usize);
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        builder
            .header(CONTENT_LENGTH, len)
            .body(buf)
            .map_err(|e| e.to_string())
    }
}

fn handle_preview_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path();
    match resolve_media_path_from_uri(path) {
        Ok(file_path) => stream_file_response(&request, &file_path).unwrap_or_else(|err| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(CONTENT_TYPE, "text/plain")
                .body(err.into_bytes())
                .unwrap_or_else(|_| Response::new(Vec::new()))
        }),
        Err(err) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(CONTENT_TYPE, "text/plain")
            .body(err.into_bytes())
            .unwrap_or_else(|_| Response::new(Vec::new())),
    }
}

pub fn register_protocol(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol("video", |_ctx, request, responder| {
        std::thread::spawn(move || {
            responder.respond(handle_preview_request(request));
        });
    })
}

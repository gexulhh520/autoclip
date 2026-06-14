use autoclip_export::{ExportFinishOptions, ExportSessionManager, ExportStartOptions};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static EXPORT_MANAGER: OnceLock<ExportSessionManager> = OnceLock::new();

fn manager() -> &'static ExportSessionManager {
    EXPORT_MANAGER.get_or_init(ExportSessionManager::default)
}

fn emit_progress(app: &AppHandle, progress: &autoclip_export::ExportProgress) {
    let _ = app.emit("export-progress", progress);
}

#[tauri::command]
pub fn compositor_export_start(
    app: AppHandle,
    options: ExportStartOptions,
) -> Result<String, String> {
    let (session_id, progress) = manager()
        .start(options)
        .map_err(|error| error.to_string())?;
    emit_progress(&app, &progress);
    Ok(session_id)
}

#[tauri::command]
pub fn compositor_export_push_frame(
    app: AppHandle,
    session_id: String,
    rgba_base64: String,
) -> Result<(), String> {
    let rgba = STANDARD
        .decode(rgba_base64.trim())
        .map_err(|error| error.to_string())?;
    let progress = manager()
        .push_frame(&session_id, &rgba)
        .map_err(|error| error.to_string())?;
    emit_progress(&app, &progress);
    Ok(())
}

#[tauri::command]
pub fn compositor_export_finish(
    app: AppHandle,
    session_id: String,
    options: ExportFinishOptions,
) -> Result<String, String> {
    let (path, progress) = manager()
        .finish(&session_id, options)
        .map_err(|error| error.to_string())?;
    emit_progress(&app, &progress);
    let _ = app.emit(
        "export-complete",
        serde_json::json!({
            "sessionId": session_id,
            "outputPath": path.to_string_lossy(),
        }),
    );
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn compositor_export_cancel(session_id: String) -> Result<(), String> {
    manager()
        .cancel(&session_id)
        .map_err(|error| error.to_string())
}

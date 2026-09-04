//! Persisted app settings.
//!
//! One JSON file in the platform config dir, read and written whole. The shape
//! is deliberately opaque here: the frontend owns what a setting means, and the
//! Rust side only owns where the file lives.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("no config dir: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("settings.json"))
}

/// The stored settings, or `null` when nothing has been saved yet.
#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(serde_json::Value::Null);
    };
    // A corrupt file reads as absent rather than as an error: settings are a
    // convenience, and refusing to start over one would be the worse failure.
    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let body = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(&path, body).map_err(|error| error.to_string())
}

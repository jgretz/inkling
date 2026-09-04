mod data;
mod migrations;
mod settings;
mod vault;
mod voice;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(data::VaultDb::default())
        .invoke_handler(tauri::generate_handler![
            vault::list_docs,
            vault::read_doc,
            vault::write_doc,
            vault::rename_doc,
            vault::delete_doc,
            settings::load_settings,
            settings::save_settings,
            data::open_vault_db,
            voice::list_suppressions,
            voice::add_suppression,
            voice::remove_suppression,
        ])
        .run(tauri::generate_context!())
        .expect("error while running inkling");
}

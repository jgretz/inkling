mod conversations;
mod data;
mod export;
mod migrations;
mod paths;
mod references;
mod revisions;
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
            vault::list_groups,
            vault::create_group,
            vault::rename_group,
            vault::read_doc,
            vault::write_doc,
            vault::create_doc,
            vault::rename_doc,
            vault::delete_doc,
            export::export_doc,
            settings::load_settings,
            settings::save_settings,
            data::open_vault_db,
            voice::list_suppressions,
            voice::add_suppression,
            voice::remove_suppression,
            references::list_references,
            references::add_reference,
            references::remove_reference,
            references::list_reference_suppressions,
            references::add_reference_suppression,
            references::remove_reference_suppression,
            conversations::list_conversations,
            conversations::create_conversation,
            conversations::delete_conversation,
            conversations::set_conversation_session,
            conversations::list_turns,
            conversations::start_turn,
            conversations::finish_turn,
            revisions::list_revisions,
            revisions::create_revision,
            revisions::read_revision,
        ])
        .run(tauri::generate_context!())
        .expect("error while running inkling");
}

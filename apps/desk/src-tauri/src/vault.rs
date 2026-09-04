//! Vault I/O.
//!
//! A vault is a plain directory of markdown files, so every command here takes
//! the vault root plus a path relative to it. The frontend never hands over an
//! absolute path: `resolve` is the single place a relative path becomes one,
//! and it refuses anything that escapes the root.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// One markdown file, as the document list needs it. The body is parsed on the
/// frontend by `@inkling/vault`, so this stays a byte-level view.
#[derive(Serialize)]
pub struct DocFile {
    /// Path relative to the vault root, POSIX separated.
    pub path: String,
    pub source: String,
    /// Last modification time as an ISO 8601 UTC string.
    pub mtime: String,
}

/// Joins a vault-relative path onto the root, rejecting traversal.
///
/// Rejecting `..` and absolute components before touching the filesystem means
/// a malformed or hostile path fails the same way whether or not the target
/// happens to exist, and never leaks whether it does.
fn resolve(vault: &str, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    for component in relative.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("path escapes the vault: {path}")),
        }
    }
    if !relative.extension().is_some_and(|ext| ext == "md") {
        return Err(format!("not a markdown file: {path}"));
    }
    Ok(Path::new(vault).join(relative))
}

fn iso_mtime(meta: &fs::Metadata) -> String {
    let seconds = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    // Formatted on the frontend; a millisecond epoch crosses the boundary
    // unambiguously and keeps a date crate out of the dependency tree.
    seconds.to_string()
}

fn relative_posix(root: &Path, entry: &Path) -> Option<String> {
    let stripped = entry.strip_prefix(root).ok()?;
    let parts: Vec<String> = stripped
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    Some(parts.join("/"))
}

/// Whether a directory is one a writer would never keep drafts in.
fn is_ignored_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<DocFile>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            if !is_ignored_dir(&name) {
                walk(root, &path, out)?;
            }
            continue;
        }
        if !path.extension().is_some_and(|ext| ext == "md") || name.starts_with('.') {
            continue;
        }

        let Some(relative) = relative_posix(root, &path) else {
            continue;
        };
        let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let meta = entry.metadata().map_err(|error| error.to_string())?;
        out.push(DocFile {
            path: relative,
            source,
            mtime: iso_mtime(&meta),
        });
    }
    Ok(())
}

/// Every markdown file under the vault, contents included.
///
/// Bodies come back with the listing rather than on demand: a personal vault is
/// a few hundred kilobytes of prose, and loading it whole is what lets search
/// and the agent's context picker work without a second round trip per file.
#[tauri::command]
pub fn list_docs(vault: String) -> Result<Vec<DocFile>, String> {
    let root = Path::new(&vault);
    if !root.is_dir() {
        return Err(format!("not a directory: {vault}"));
    }
    let mut out = Vec::new();
    walk(root, root, &mut out)?;
    Ok(out)
}

#[tauri::command]
pub fn read_doc(vault: String, path: String) -> Result<DocFile, String> {
    let resolved = resolve(&vault, &path)?;
    let source = fs::read_to_string(&resolved).map_err(|error| error.to_string())?;
    let meta = fs::metadata(&resolved).map_err(|error| error.to_string())?;
    Ok(DocFile {
        path,
        source,
        mtime: iso_mtime(&meta),
    })
}

/// Writes a document, creating parent directories as needed.
#[tauri::command]
pub fn write_doc(vault: String, path: String, source: String) -> Result<String, String> {
    let resolved = resolve(&vault, &path)?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&resolved, source).map_err(|error| error.to_string())?;
    let meta = fs::metadata(&resolved).map_err(|error| error.to_string())?;
    Ok(iso_mtime(&meta))
}

/// Moves a document to a new vault-relative path. Refuses to clobber.
#[tauri::command]
pub fn rename_doc(vault: String, from: String, to: String) -> Result<(), String> {
    let source = resolve(&vault, &from)?;
    let target = resolve(&vault, &to)?;
    if target.exists() {
        return Err(format!("already exists: {to}"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&source, &target).map_err(|error| error.to_string())
}

/// Deletes a document. The caller is responsible for confirming with the writer.
#[tauri::command]
pub fn delete_doc(vault: String, path: String) -> Result<(), String> {
    let resolved = resolve(&vault, &path)?;
    fs::remove_file(&resolved).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::resolve;

    #[test]
    fn resolve_rejects_parent_traversal() {
        assert!(resolve("/vault", "../secrets.md").is_err());
    }

    #[test]
    fn resolve_rejects_absolute_paths() {
        assert!(resolve("/vault", "/etc/passwd.md").is_err());
    }

    #[test]
    fn resolve_rejects_non_markdown() {
        assert!(resolve("/vault", "notes/todo.txt").is_err());
    }

    #[test]
    fn resolve_joins_a_nested_relative_path() {
        let resolved = resolve("/vault", "drafts/on-writing.md").expect("should resolve");

        assert_eq!(resolved.to_string_lossy(), "/vault/drafts/on-writing.md");
    }
}

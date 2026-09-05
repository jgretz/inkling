//! Writing a document out of the vault.
//!
//! Deliberately not through `vault::resolve`. Containment there exists to stop
//! a vault-relative path escaping the vault root, and an export lands outside
//! the vault on purpose: that is the whole gesture. What this refuses instead
//! is a path the writer never chose, since the only legitimate caller hands
//! over what the OS save dialog returned.
//!
//! It also never creates a directory. The dialog's parent exists by
//! construction, so a missing one means the path came from somewhere else, and
//! creating it silently would put the file somewhere nobody picked.

use std::fs;
use std::path::Path;

#[tauri::command]
pub fn export_doc(path: String, source: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    let Some(parent) = target.parent() else {
        return Err(format!("no directory to write into: {path}"));
    };
    if !parent.is_dir() {
        return Err(format!("no such directory: {}", parent.display()));
    }
    fs::write(target, source).map_err(|error| format!("could not write {path}: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::export_doc;

    /// The command is an ordinary function, the way `vault::create_doc` is, so
    /// these call it directly rather than through a Tauri app handle.
    #[test]
    fn writes_the_source_to_the_chosen_path() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("piece.md");

        export_doc(
            target.to_string_lossy().into_owned(),
            "# Title\n\nA paragraph.\n".to_string(),
        )
        .unwrap();

        let written = fs::read_to_string(&target).unwrap();
        assert_eq!(written, "# Title\n\nA paragraph.\n");
    }

    #[test]
    fn refuses_a_relative_path() {
        let error = export_doc("piece.md".to_string(), "body".to_string()).unwrap_err();

        assert!(error.contains("not an absolute path"), "{error}");
    }

    #[test]
    fn refuses_a_parent_directory_that_is_not_there() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("nowhere").join("piece.md");

        let error =
            export_doc(target.to_string_lossy().into_owned(), "body".to_string()).unwrap_err();

        assert!(error.contains("no such directory"), "{error}");
        assert!(!target.exists());
    }
}

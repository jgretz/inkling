//! Vault I/O.
//!
//! A vault is a plain directory of markdown files, so every command here takes
//! the vault root plus a path relative to it. The frontend never hands over an
//! absolute path: `resolve` and `resolve_dir` are the only two places a
//! relative path becomes one, `resolve` for a document and `resolve_dir` for a
//! group, and both refuse anything that escapes the root.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::data::VaultDb;
use crate::paths::{rewrite_exact, rewrite_prefix};

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

/// Joins a vault-relative **directory** path onto the root, rejecting traversal.
///
/// The same containment rule as [`resolve`], written alongside it rather than
/// folded into it: a group is not a markdown file, and loosening the extension
/// check in the one place every document path goes through would be the wrong
/// trade. Two extra refusals of its own: the vault root is not a group, and
/// neither is any segment [`is_ignored_dir`] hides, because a group named
/// `.drafts` is one the library could never list.
fn resolve_dir(vault: &str, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    let mut segments = 0;
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                if is_ignored_dir(&part.to_string_lossy()) {
                    return Err(format!("not a group inkling can show: {path}"));
                }
                segments += 1;
            }
            _ => return Err(format!("path escapes the vault: {path}")),
        }
    }
    if segments == 0 {
        return Err("the vault root is not a group".to_string());
    }
    Ok(Path::new(vault).join(relative))
}

/// A vault-relative path in the POSIX form the frontend and the database use.
///
/// Callers run it on a path `resolve` or `resolve_dir` has already accepted, so
/// every component is `Normal` and nothing is dropped. It exists so `drafts/`
/// and `drafts` cannot key the database differently from the directory that
/// just moved.
fn posix(path: &str) -> String {
    Path::new(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<String>>()
        .join("/")
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

fn walk_groups(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
            || is_ignored_dir(&name)
        {
            continue;
        }
        let Some(relative) = relative_posix(root, &path) else {
            continue;
        };
        out.push(relative);
        walk_groups(root, &path, out)?;
    }
    Ok(())
}

/// Every directory under the vault, as vault-relative POSIX paths, sorted.
///
/// Separate from [`list_docs`], which returns files: a group a writer has just
/// made and put nothing in yet holds no markdown, so the document listing
/// cannot see it and it would vanish at the next scan.
#[tauri::command]
pub fn list_groups(vault: String) -> Result<Vec<String>, String> {
    let root = Path::new(&vault);
    if !root.is_dir() {
        return Err(format!("not a directory: {vault}"));
    }
    let mut out = Vec::new();
    walk_groups(root, root, &mut out)?;
    out.sort();
    Ok(out)
}

/// Makes a group, and every group above it that does not exist yet.
#[tauri::command]
pub fn create_group(vault: String, path: String) -> Result<(), String> {
    let resolved = resolve_dir(&vault, &path)?;
    if resolved.exists() {
        return Err(format!("already exists: {path}"));
    }
    fs::create_dir_all(&resolved).map_err(|error| error.to_string())
}

/// Renames a group, carrying everything stored against the documents inside it.
///
/// The order is: open a transaction, rewrite the rows, rename the directory,
/// and commit last. That is deliberate and it is the only order with no window
/// a writer has to clean up after. A SQLite transaction can be abandoned for
/// nothing, so the half that can be undone straddles the half that cannot: a
/// failed `fs::rename` drops the transaction on the way out and both halves are
/// exactly as they were.
///
/// One residual case remains, a commit that fails after the directory has
/// already moved. It is handled by renaming the directory back and reporting
/// both failures. If that reverse rename also fails, the error says plainly
/// that the directory moved and the dismissals under it did not, because that
/// is a state only the writer can resolve.
///
/// With no database open there is nothing to carry, so the directory rename
/// happens alone. That is the same degradation `dataNotice` already explains.
#[tauri::command]
pub fn rename_group(
    vault: String,
    from: String,
    to: String,
    db: State<'_, VaultDb>,
) -> Result<(), String> {
    rename_group_with(&vault, &from, &to, &db)
}

fn rename_group_with(vault: &str, from: &str, to: &str, db: &VaultDb) -> Result<(), String> {
    let source = resolve_dir(vault, from)?;
    let target = resolve_dir(vault, to)?;
    if !source.is_dir() {
        return Err(format!("not a group: {from}"));
    }
    if target.exists() {
        return Err(format!("already exists: {to}"));
    }

    let old = posix(from);
    let new = posix(to);
    if new == old || new.starts_with(&format!("{old}/")) {
        return Err(format!("a group cannot move inside itself: {from}"));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let carried = db.with(|conn| -> Result<(), String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| format!("renaming {from} to {to}: {error}"))?;
        rewrite_prefix(&tx, &old, &new).map_err(|error| format!("renaming {from} to {to}: {error}"))?;

        fs::rename(&source, &target).map_err(|error| error.to_string())?;

        tx.commit().map_err(|error| match fs::rename(&target, &source) {
            Ok(()) => format!("renaming {from} to {to}: {error}. Nothing moved."),
            Err(reverse) => format!(
                "{to} is now the folder that was {from}, but the dismissals inside it did not move: {error}. Moving it back also failed: {reverse}"
            ),
        })
    });

    match carried {
        Some(result) => result,
        None => fs::rename(&source, &target).map_err(|error| error.to_string()),
    }
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

/// Writes a document that is not there yet. Refuses to clobber.
///
/// Separate from [`write_doc`], which must overwrite because it is what the
/// autosave calls. Creating is the opposite case: two documents a writer titles
/// the same way slug to the same filename, and an overwrite there would take
/// the first one's prose with it.
#[tauri::command]
pub fn create_doc(vault: String, path: String, source: String) -> Result<(), String> {
    let resolved = resolve(&vault, &path)?;
    if resolved.exists() {
        return Err(format!("already exists: {path}"));
    }
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&resolved, source).map_err(|error| error.to_string())
}

/// Moves a document to a new vault-relative path, carrying its dismissals with
/// it. Refuses to clobber.
///
/// Same order and the same reasoning as [`rename_group`], one document wide.
/// The `db` argument is injected by Tauri from managed state, so the frontend's
/// `invoke` payload is unchanged.
#[tauri::command]
pub fn rename_doc(
    vault: String,
    from: String,
    to: String,
    db: State<'_, VaultDb>,
) -> Result<(), String> {
    rename_doc_with(&vault, &from, &to, &db)
}

fn rename_doc_with(vault: &str, from: &str, to: &str, db: &VaultDb) -> Result<(), String> {
    let source = resolve(vault, from)?;
    let target = resolve(vault, to)?;
    if target.exists() {
        return Err(format!("already exists: {to}"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let old = posix(from);
    let new = posix(to);

    let carried = db.with(|conn| -> Result<(), String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| format!("moving {from} to {to}: {error}"))?;
        rewrite_exact(&tx, &old, &new).map_err(|error| format!("moving {from} to {to}: {error}"))?;

        fs::rename(&source, &target).map_err(|error| error.to_string())?;

        tx.commit().map_err(|error| match fs::rename(&target, &source) {
            Ok(()) => format!("moving {from} to {to}: {error}. Nothing moved."),
            Err(reverse) => format!(
                "{to} is now the document that was {from}, but its dismissals did not move: {error}. Moving it back also failed: {reverse}"
            ),
        })
    });

    match carried {
        Some(result) => result,
        None => fs::rename(&source, &target).map_err(|error| error.to_string()),
    }
}

/// Deletes a document. The caller is responsible for confirming with the writer.
#[tauri::command]
pub fn delete_doc(vault: String, path: String) -> Result<(), String> {
    let resolved = resolve(&vault, &path)?;
    fs::remove_file(&resolved).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        create_doc, create_group, list_docs, list_groups, rename_doc_with, rename_group_with,
        resolve, resolve_dir,
    };
    use crate::data::VaultDb;
    use crate::references::{
        insert as attach, insert_suppression, select_all, select_all_suppressions, NewReference,
        Reference,
    };
    use crate::revisions::{insert as keep_revision, select_for as revisions_of};
    use crate::voice::{insert, select_for_doc, Suppression};
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

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

    fn doc_paths(vault: &Path) -> Vec<String> {
        let mut paths: Vec<String> = list_docs(vault.to_string_lossy().into_owned())
            .expect("should list")
            .into_iter()
            .map(|doc| doc.path)
            .collect();
        paths.sort();
        paths
    }

    /// `is_ignored_dir` already skips any dotted directory, so the data
    /// directory cannot reach the document list. This pins that, because
    /// `.inkling/` is the first thing inkling itself puts inside a vault.
    #[test]
    fn list_docs_ignores_the_data_directory() {
        let vault = tempdir().expect("should make a temp dir");
        fs::write(vault.path().join("a.md"), "# a\n").expect("should write");
        fs::create_dir_all(vault.path().join("drafts")).expect("should make a dir");
        fs::write(vault.path().join("drafts/b.md"), "# b\n").expect("should write");
        // Markdown, so only the dotted-directory skip can keep it out.
        fs::create_dir_all(vault.path().join(".inkling")).expect("should make a dir");
        fs::write(vault.path().join(".inkling/notes.md"), "# not prose\n").expect("should write");

        let before = doc_paths(vault.path());
        VaultDb::default().open(vault.path()).expect("should open");
        let after = doc_paths(vault.path());

        assert_eq!(before, vec!["a.md", "drafts/b.md"]);
        assert_eq!(after, vec!["a.md", "drafts/b.md"]);
    }

    #[test]
    fn resolve_dir_rejects_parent_traversal() {
        assert!(resolve_dir("/vault", "../secrets").is_err());
    }

    #[test]
    fn resolve_dir_rejects_absolute_paths() {
        assert!(resolve_dir("/vault", "/etc").is_err());
    }

    /// A group the library could never list is not a group a writer may make.
    #[test]
    fn resolve_dir_rejects_a_directory_the_listing_hides() {
        assert!(resolve_dir("/vault", ".inkling").is_err());
        assert!(resolve_dir("/vault", "drafts/.hidden").is_err());
    }

    #[test]
    fn resolve_dir_rejects_the_vault_root() {
        assert!(resolve_dir("/vault", "").is_err());
    }

    #[test]
    fn resolve_dir_joins_a_nested_relative_path() {
        let resolved = resolve_dir("/vault", "drafts/deep").expect("should resolve");

        assert_eq!(resolved.to_string_lossy(), "/vault/drafts/deep");
    }

    fn group_paths(vault: &Path) -> Vec<String> {
        list_groups(vault.to_string_lossy().into_owned()).expect("should list")
    }

    #[test]
    fn list_groups_reports_a_nested_group_and_skips_the_data_directory() {
        let vault = tempdir().expect("should make a temp dir");
        fs::create_dir_all(vault.path().join("drafts/deep")).expect("should make a dir");
        fs::create_dir_all(vault.path().join(".inkling")).expect("should make a dir");
        fs::write(vault.path().join("a.md"), "# a\n").expect("should write");

        assert_eq!(group_paths(vault.path()), vec!["drafts", "drafts/deep"]);
    }

    #[test]
    fn create_group_refuses_to_escape_the_vault() {
        let vault = tempdir().expect("should make a temp dir");

        let result = create_group(
            vault.path().to_string_lossy().into_owned(),
            "../x".to_string(),
        );

        assert!(result.is_err());
        assert!(!vault
            .path()
            .parent()
            .expect("has a parent")
            .join("x")
            .exists());
    }

    #[test]
    fn create_group_refuses_a_group_that_is_already_there() {
        let vault = tempdir().expect("should make a temp dir");
        fs::create_dir_all(vault.path().join("drafts")).expect("should make a dir");

        let result = create_group(
            vault.path().to_string_lossy().into_owned(),
            "drafts".to_string(),
        );

        assert!(result.is_err_and(|error| error.contains("drafts")));
    }

    #[test]
    fn create_group_makes_a_group_and_its_missing_parents() {
        let vault = tempdir().expect("should make a temp dir");

        create_group(
            vault.path().to_string_lossy().into_owned(),
            "essays/2026".to_string(),
        )
        .expect("should create");

        assert_eq!(group_paths(vault.path()), vec!["essays", "essays/2026"]);
    }

    #[test]
    fn create_doc_writes_a_document_that_is_not_there_yet() {
        let vault = tempdir().expect("should make a temp dir");

        create_doc(
            vault.path().to_string_lossy().into_owned(),
            "essays/on-endings.md".to_string(),
            "# On Endings\n\n".to_string(),
        )
        .expect("should create");

        assert_eq!(
            fs::read_to_string(vault.path().join("essays/on-endings.md")).expect("should be there"),
            "# On Endings\n\n"
        );
    }

    /// Two documents a writer titles the same way slug to the same filename, so
    /// the second must be refused rather than written over the first.
    #[test]
    fn create_doc_refuses_to_overwrite_a_document_that_is_already_there() {
        let vault = tempdir().expect("should make a temp dir");
        fs::write(vault.path().join("a.md"), "# the writer's prose\n").expect("should write");

        let result = create_doc(
            vault.path().to_string_lossy().into_owned(),
            "a.md".to_string(),
            "# On Endings\n\n".to_string(),
        );

        assert!(result.is_err_and(|error| error.contains("a.md")));
        assert_eq!(
            fs::read_to_string(vault.path().join("a.md")).expect("should be there"),
            "# the writer's prose\n"
        );
    }

    /// A vault with a group, a document inside it and the database open, which
    /// is what every rename test below starts from.
    fn vault_with_a_group(group: &str) -> (tempfile::TempDir, VaultDb) {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();
        db.open(vault.path()).expect("should open");
        fs::create_dir_all(vault.path().join(group)).expect("should make a dir");
        fs::write(vault.path().join(group).join("a.md"), "# a\n").expect("should write");
        (vault, db)
    }

    fn dismiss(db: &VaultDb, doc_path: &str) {
        db.with(|conn| insert(conn, doc_path, "em-dash", "—", "before ", " after", 12))
            .expect("a vault should be open")
            .expect("should insert");
    }

    fn listed(db: &VaultDb, doc_path: &str) -> Vec<Suppression> {
        db.with(|conn| select_for_doc(conn, doc_path))
            .expect("a vault should be open")
            .expect("should select")
    }

    fn rename_group_in(vault: &Path, db: &VaultDb, from: &str, to: &str) -> Result<(), String> {
        rename_group_with(&vault.to_string_lossy(), from, to, db)
    }

    #[test]
    fn should_read_a_dismissal_at_its_new_path_after_the_group_is_renamed() {
        let (vault, db) = vault_with_a_group("drafts");
        dismiss(&db, "drafts/a.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(listed(&db, "essays/a.md").len(), 1);
        assert_eq!(listed(&db, "drafts/a.md").len(), 0);
        assert!(vault.path().join("essays/a.md").is_file());
        assert!(!vault.path().join("drafts").exists());
    }

    #[test]
    fn should_carry_a_dismissal_in_a_group_nested_below_the_renamed_one() {
        let (vault, db) = vault_with_a_group("drafts/2026");
        dismiss(&db, "drafts/2026/a.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(listed(&db, "essays/2026/a.md").len(), 1);
        assert_eq!(listed(&db, "drafts/2026/a.md").len(), 0);
        assert!(vault.path().join("essays/2026/a.md").is_file());
    }

    /// The rename that has to leave nothing half done: the target is already
    /// there, so neither the directory nor a single row may move.
    #[test]
    fn should_change_nothing_at_all_when_the_target_group_already_exists() {
        let (vault, db) = vault_with_a_group("drafts");
        dismiss(&db, "drafts/a.md");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        fs::write(vault.path().join("essays/b.md"), "# b\n").expect("should write");
        dismiss(&db, "essays/b.md");
        let before = listed(&db, "drafts/a.md");
        let target_before = listed(&db, "essays/b.md");

        let result = rename_group_in(vault.path(), &db, "drafts", "essays");

        assert!(result.is_err_and(|error| error.contains("essays")));
        assert!(vault.path().join("drafts/a.md").is_file());
        assert_eq!(
            fs::read_to_string(vault.path().join("essays/b.md")).expect("should still be there"),
            "# b\n"
        );
        assert_eq!(listed(&db, "drafts/a.md"), before);
        assert_eq!(listed(&db, "essays/b.md"), target_before);
    }

    /// A group renamed onto a name whose orphaned rows would collide. The
    /// target directory does not exist, so those rows belong to nothing.
    #[test]
    fn should_replace_orphaned_rows_left_at_the_target_name() {
        let (vault, db) = vault_with_a_group("drafts");
        dismiss(&db, "drafts/a.md");
        // The same anchor, filed against a document at the target path that is
        // not on disk: exactly what an earlier `essays/` left behind.
        dismiss(&db, "essays/a.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(listed(&db, "essays/a.md").len(), 1);
        assert_eq!(listed(&db, "drafts/a.md").len(), 0);
    }

    /// A rename of `drafts` must not touch `drafts2`, which shares its first
    /// six characters and nothing else.
    #[test]
    fn should_leave_a_sibling_group_with_a_longer_name_alone() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("drafts2")).expect("should make a dir");
        fs::write(vault.path().join("drafts2/a.md"), "# a\n").expect("should write");
        dismiss(&db, "drafts2/a.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(listed(&db, "drafts2/a.md").len(), 1);
        assert!(vault.path().join("drafts2/a.md").is_file());
    }

    /// The claim the whole order exists to make: the rows are rewritten first,
    /// so a directory that will not move takes the rewrite down with it.
    ///
    /// A read-only vault root is the cheapest way to make `fs::rename` fail
    /// after the transaction is already open. `.inkling/` keeps its own mode, so
    /// SQLite can still write while the rename cannot.
    #[cfg(unix)]
    #[test]
    fn should_leave_every_row_where_it_was_when_the_directory_will_not_move() {
        use std::os::unix::fs::PermissionsExt;

        let (vault, db) = vault_with_a_group("drafts");
        dismiss(&db, "drafts/a.md");
        let before = listed(&db, "drafts/a.md");
        fs::set_permissions(vault.path(), fs::Permissions::from_mode(0o555))
            .expect("should make the vault read-only");

        let result = rename_group_in(vault.path(), &db, "drafts", "essays");

        fs::set_permissions(vault.path(), fs::Permissions::from_mode(0o755))
            .expect("should restore the vault");
        assert!(
            result.is_err(),
            "a read-only vault should refuse the rename"
        );
        assert_eq!(listed(&db, "drafts/a.md"), before);
        assert_eq!(listed(&db, "essays/a.md").len(), 0);
        assert!(vault.path().join("drafts/a.md").is_file());
    }

    #[test]
    fn should_still_move_the_directory_when_no_vault_database_is_open() {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();
        fs::create_dir_all(vault.path().join("drafts")).expect("should make a dir");
        fs::write(vault.path().join("drafts/a.md"), "# a\n").expect("should write");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert!(vault.path().join("essays/a.md").is_file());
        assert!(!vault.path().join("drafts").exists());
    }

    #[test]
    fn should_refuse_to_move_a_group_inside_itself() {
        let (vault, db) = vault_with_a_group("drafts");

        let result = rename_group_in(vault.path(), &db, "drafts", "drafts/inner");

        assert!(result.is_err());
        assert!(vault.path().join("drafts/a.md").is_file());
    }

    /// A link attached to a group, which is the case `GROUP_KEYED` exists for:
    /// the stored value is the group's own path, not a path under it.
    fn attach_to_group(db: &VaultDb, group: &str, url: &str) -> Reference {
        db.with(|conn| {
            attach(
                conn,
                &NewReference {
                    doc_path: None,
                    group_path: Some(group),
                    kind: "link",
                    target_path: None,
                    url: Some(url),
                    title: "The style guide",
                },
            )
        })
        .expect("a vault should be open")
        .expect("should attach")
    }

    /// A document referring to another document, which puts a path in both the
    /// owner column and the target column.
    fn attach_to_doc(db: &VaultDb, owner: &str, target: &str) -> Reference {
        db.with(|conn| {
            attach(
                conn,
                &NewReference {
                    doc_path: Some(owner),
                    group_path: None,
                    kind: "doc",
                    target_path: Some(target),
                    url: None,
                    title: "Notes on endings",
                },
            )
        })
        .expect("a vault should be open")
        .expect("should attach")
    }

    /// A group's reference naming another document, which is the only shape a
    /// suppression may be filed against.
    fn attach_to_group_doc(db: &VaultDb, group: &str, target: &str) -> Reference {
        db.with(|conn| {
            attach(
                conn,
                &NewReference {
                    doc_path: None,
                    group_path: Some(group),
                    kind: "doc",
                    target_path: Some(target),
                    url: None,
                    title: "Notes on endings",
                },
            )
        })
        .expect("a vault should be open")
        .expect("should attach")
    }

    fn references(db: &VaultDb) -> Vec<Reference> {
        db.with(select_all)
            .expect("a vault should be open")
            .expect("should select")
    }

    /// The one reference in the vault, for the tests that store exactly one.
    fn only_reference(db: &VaultDb) -> Reference {
        let mut all = references(db);
        assert_eq!(all.len(), 1, "expected exactly one reference");
        all.remove(0)
    }

    #[test]
    fn should_read_a_group_reference_at_the_new_group_after_it_is_renamed() {
        let (vault, db) = vault_with_a_group("drafts");
        attach_to_group(&db, "drafts", "https://example.com");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(only_reference(&db).group_path.as_deref(), Some("essays"));
    }

    /// The exact-match half of the group rewrite is new code, so the sibling
    /// case is asserted for the group column too: `drafts2` shares six
    /// characters with `drafts` and nothing else.
    #[test]
    fn should_leave_a_sibling_groups_reference_alone_when_a_group_is_renamed() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("drafts2")).expect("should make a dir");
        attach_to_group(&db, "drafts2", "https://example.com");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(only_reference(&db).group_path.as_deref(), Some("drafts2"));
    }

    #[test]
    fn should_carry_a_reference_owned_by_a_document_below_the_renamed_group() {
        let (vault, db) = vault_with_a_group("drafts/2026");
        attach_to_doc(&db, "drafts/2026/a.md", "notes/b.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        let row = only_reference(&db);
        assert_eq!(row.doc_path.as_deref(), Some("essays/2026/a.md"));
        // The target was outside the renamed group, so it must not have moved.
        assert_eq!(row.target_path.as_deref(), Some("notes/b.md"));
    }

    #[test]
    fn should_carry_a_reference_whose_target_is_inside_the_renamed_group() {
        let (vault, db) = vault_with_a_group("drafts");
        attach_to_doc(&db, "notes/x.md", "drafts/a.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        let row = only_reference(&db);
        assert_eq!(row.target_path.as_deref(), Some("essays/a.md"));
        assert_eq!(row.doc_path.as_deref(), Some("notes/x.md"));
    }

    #[test]
    fn should_carry_a_turned_off_reference_when_its_document_moves_under_a_rename() {
        let (vault, db) = vault_with_a_group("drafts");
        let inherited = attach_to_group(&db, "drafts", "https://example.com");
        db.with(|conn| insert_suppression(conn, "drafts/a.md", inherited.id))
            .expect("a vault should be open")
            .expect("should turn it off");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        let off = db
            .with(select_all_suppressions)
            .expect("a vault should be open")
            .expect("should select");
        assert_eq!(off.len(), 1);
        assert_eq!(off[0].doc_path, "essays/a.md");
        assert_eq!(off[0].reference_id, inherited.id);
    }

    /// A reference whose file went missing outside inkling is kept and shown
    /// broken, so a rename that puts a file back at that path has to leave it
    /// alone rather than sweep it as an orphan. The target column points at
    /// another row's subject; it does not identify this one.
    #[test]
    fn should_revive_a_broken_reference_when_a_group_rename_puts_its_target_back() {
        let (vault, db) = vault_with_a_group("drafts");
        attach_to_doc(&db, "notes/x.md", "essays/a.md");

        rename_group_in(vault.path(), &db, "drafts", "essays").expect("should rename");

        assert_eq!(
            only_reference(&db).target_path.as_deref(),
            Some("essays/a.md")
        );
    }

    /// The same, one document wide, through `rewrite_exact`.
    #[test]
    fn should_revive_a_broken_reference_when_a_document_moves_onto_its_target() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        attach_to_doc(&db, "notes/x.md", "essays/a.md");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        assert_eq!(
            only_reference(&db).target_path.as_deref(),
            Some("essays/a.md")
        );
    }

    /// Two of one document's references collapsing onto one file: the rename
    /// must merge them rather than fail on the unique index, and the row that
    /// followed the file is the one that survives.
    #[test]
    fn should_merge_two_references_a_rename_points_at_the_same_file() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        let following = attach_to_doc(&db, "notes/x.md", "drafts/a.md");
        attach_to_doc(&db, "notes/x.md", "essays/a.md");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        let row = only_reference(&db);
        assert_eq!(row.id, following.id);
        assert_eq!(row.target_path.as_deref(), Some("essays/a.md"));
    }

    /// The merge above deletes a row, so the foreign key has to sweep what was
    /// filed against it. A suppression left pointing at a gone reference is
    /// either a dangling row or a constraint failure that fails the rename.
    #[test]
    fn should_sweep_a_suppression_filed_against_a_reference_a_rename_merges_away() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        let following = attach_to_group_doc(&db, "drafts", "drafts/a.md");
        let merged = attach_to_group_doc(&db, "drafts", "essays/a.md");
        db.with(|conn| insert_suppression(conn, "drafts/x.md", merged.id))
            .expect("a vault should be open")
            .expect("should turn it off");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        assert_eq!(only_reference(&db).id, following.id);
        let off = db
            .with(select_all_suppressions)
            .expect("a vault should be open")
            .expect("should select");
        assert!(off.is_empty(), "left a suppression behind: {off:?}");
    }

    #[test]
    fn should_carry_a_reference_target_when_one_document_moves() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        attach_to_doc(&db, "notes/x.md", "drafts/a.md");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        assert_eq!(
            only_reference(&db).target_path.as_deref(),
            Some("essays/a.md")
        );
    }

    /// Moving a document changes no group, so the group column must be left
    /// exactly where it is. This is why `rewrite_exact` loops `PATH_KEYED` only.
    #[test]
    fn should_leave_a_group_reference_alone_when_one_document_moves() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        attach_to_group(&db, "drafts", "https://example.com");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        assert_eq!(only_reference(&db).group_path.as_deref(), Some("drafts"));
    }

    fn keep(db: &VaultDb, doc_path: &str, source: &str) {
        db.with(|conn| keep_revision(conn, doc_path, source))
            .expect("a vault should be open")
            .expect("should keep a revision");
    }

    fn revisions(db: &VaultDb, doc_path: &str) -> usize {
        db.with(|conn| revisions_of(conn, doc_path))
            .expect("a vault should be open")
            .expect("should select")
            .len()
    }

    /// A revision holds prose that is nowhere else in the vault, so a rename
    /// that dropped one would lose the writer's only way back to that draft.
    #[test]
    fn should_read_a_revision_at_the_new_path_after_a_document_moves() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        keep(&db, "drafts/a.md", "# a\n");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        assert_eq!(revisions(&db, "essays/a.md"), 1);
        assert_eq!(revisions(&db, "drafts/a.md"), 0);
    }

    #[test]
    fn should_read_a_revision_at_the_new_path_after_the_group_is_renamed() {
        let (vault, db) = vault_with_a_group("drafts");
        keep(&db, "drafts/a.md", "# a\n");

        rename_group_in(vault.path(), &db, "drafts", "notes").expect("should rename");

        assert_eq!(revisions(&db, "notes/a.md"), 1);
        assert_eq!(revisions(&db, "drafts/a.md"), 0);
        assert!(vault.path().join("notes/a.md").is_file());
    }

    #[test]
    fn should_read_a_dismissal_at_the_new_path_after_a_document_moves() {
        let (vault, db) = vault_with_a_group("drafts");
        fs::create_dir_all(vault.path().join("essays")).expect("should make a dir");
        dismiss(&db, "drafts/a.md");

        rename_doc_with(
            &vault.path().to_string_lossy(),
            "drafts/a.md",
            "essays/a.md",
            &db,
        )
        .expect("should move");

        assert_eq!(listed(&db, "essays/a.md").len(), 1);
        assert_eq!(listed(&db, "drafts/a.md").len(), 0);
        assert!(vault.path().join("essays/a.md").is_file());
    }
}

//! The vault's data directory.
//!
//! Everything inkling knows about a vault that is not the writer's prose lives
//! in `.inkling/inkling.db` inside the vault itself, beside the files it
//! describes, where the writer can see it and delete it. Deleting it is the
//! whole recovery story, which is what makes it safe to keep out of their
//! version control.
//!
//! SQL never crosses into the webview. The frontend calls [`open_vault_db`] and
//! gets back a status; the connection stays here, one per vault, swapped under
//! a lock.
//!
//! The database is left on SQLite's default rollback journal rather than WAL.
//! A vault plausibly lives in iCloud Drive or Dropbox, where WAL's shared-memory
//! file is the known failure mode, and inkling holds exactly one connection in
//! one process, so WAL would buy nothing.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::migrations::migrate;

const DATA_DIR: &str = ".inkling";
const DB_FILE: &str = "inkling.db";

/// Both paths are the vault root joined with a constant. No caller-supplied
/// component reaches either, which is why `vault::resolve` is not involved.
fn data_dir(vault: &Path) -> PathBuf {
    vault.join(DATA_DIR)
}

fn db_path(vault: &Path) -> PathBuf {
    data_dir(vault).join(DB_FILE)
}

/// Creates `.inkling/`, and its `.gitignore` when there is not one already.
///
/// The gitignore is a courtesy to the writer's own repository, not a
/// precondition for the database, so a failure to write it is logged and
/// swallowed. An existing one is left alone: a writer may have customised it.
fn ensure_data_dir(vault: &Path) -> io::Result<()> {
    let dir = data_dir(vault);
    fs::create_dir_all(&dir)?;

    let ignore = dir.join(".gitignore");
    if !ignore.exists() {
        if let Err(error) = fs::write(&ignore, "*\n") {
            eprintln!("inkling: could not write {}: {error}", ignore.display());
        }
    }
    Ok(())
}

/// Opens the database file itself, with no schema work.
///
/// No `integrity_check`: it is proportional to the database's size and would
/// grow into a startup cost every writer pays. A corrupt file surfaces on the
/// `user_version` read at the head of `migrate` instead.
fn open_connection(vault: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path(vault))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    Ok(conn)
}

/// What the frontend learns about the vault's database.
///
/// `Unavailable` is a status rather than an error on purpose: a vault whose
/// database will not open still lists and edits its documents, and refusing to
/// open it at all would be the worse failure. `settings.rs` degrades the same
/// way when its file is unreadable.
///
/// The serialised shape is a contract with `VaultDbStatus` in
/// `src/lib/bridge.ts`, which is a hand-written mirror rather than a generated
/// one. `serialises_to_the_shape_the_frontend_reads` pins it, because dropping
/// a `rename_all` here would leave the frontend reading `undefined` with every
/// other test still green.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VaultDbStatus {
    #[serde(rename_all = "camelCase")]
    Ready { schema_version: i32 },
    #[serde(rename_all = "camelCase")]
    Unavailable { message: String },
}

/// The one open connection, or none when no vault is open or the last open
/// failed.
#[derive(Default)]
pub struct VaultDb(Mutex<Option<Connection>>);

/// Everything between "there is a vault" and "there is a usable connection".
///
/// Split out so [`VaultDb::open`] holds the lock across one expression and every
/// failure in here lands in the same `Unavailable` message. Each error names the
/// step it came from, because that message is what the writer reads.
fn open_and_migrate(vault: &Path) -> Result<(Connection, i32), String> {
    ensure_data_dir(vault).map_err(|error| format!("{}: {error}", data_dir(vault).display()))?;
    let mut conn = open_connection(vault).map_err(|error| error.to_string())?;
    let version = migrate(&mut conn)?;
    Ok((conn, version))
}

impl VaultDb {
    /// Points the app at a vault, creating and migrating its database.
    ///
    /// The close and the reopen happen under one lock acquisition, so switching
    /// vaults is atomic: there is no window in which a query could reach the
    /// old vault's data after the new one is open. That is also why there is no
    /// `close_vault_db` command. React fires an effect's cleanup and the next
    /// effect body without awaiting either invoke, so a separate close could
    /// land on a freshly opened connection.
    ///
    /// Returns `Err` only when the vault root is not a directory, matching
    /// `list_docs`. Every other failure comes back as `Unavailable`.
    pub fn open(&self, vault: &Path) -> Result<VaultDbStatus, String> {
        if !vault.is_dir() {
            return Err(format!("not a directory: {}", vault.display()));
        }

        let mut slot = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(previous) = slot.take() {
            if let Err((_, error)) = previous.close() {
                eprintln!("inkling: could not close the previous vault database: {error}");
            }
        }

        match open_and_migrate(vault) {
            Ok((conn, schema_version)) => {
                *slot = Some(conn);
                Ok(VaultDbStatus::Ready { schema_version })
            }
            Err(message) => Ok(VaultDbStatus::Unavailable { message }),
        }
    }

    /// Runs a closure against the open connection, or returns `None` when there
    /// is none.
    ///
    /// This is the read path every stored-data command goes through: `voice.rs`,
    /// `references.rs` and `conversations.rs` alike. `None` is a real answer
    /// rather than an error, because a writer who has not chosen a vault yet has
    /// no connection and that is not a failure.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> T) -> Option<T> {
        let slot = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.as_ref().map(f)
    }
}

/// Synchronous, matching every command in `vault.rs`: opening a vault runs one
/// small migration, and `list_docs` already reads the whole vault on this
/// thread.
#[tauri::command]
pub fn open_vault_db(vault: String, db: State<'_, VaultDb>) -> Result<VaultDbStatus, String> {
    db.open(Path::new(&vault))
}

#[cfg(test)]
mod tests {
    use super::{data_dir, db_path, VaultDb, VaultDbStatus};
    use std::fs;
    use tempfile::tempdir;

    fn insert_probe(db: &VaultDb, value: &str) {
        let inserted = db
            .with(|conn| {
                conn.execute(
                    "INSERT INTO meta (key, value) VALUES ('probe', ?1)",
                    [value],
                )
            })
            .expect("a vault should be open");

        inserted.expect("should insert the probe row");
    }

    fn probe(db: &VaultDb) -> Option<String> {
        db.with(|conn| {
            conn.query_row("SELECT value FROM meta WHERE key = 'probe'", [], |row| {
                row.get::<_, String>(0)
            })
            .ok()
        })
        .expect("a vault should be open")
    }

    #[test]
    fn should_create_the_data_directory_when_the_vault_has_none() {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();

        let status = db.open(vault.path()).expect("should open");

        assert_eq!(status, VaultDbStatus::Ready { schema_version: 4 });
        assert!(db_path(vault.path()).is_file());
        let ignore = fs::read_to_string(data_dir(vault.path()).join(".gitignore"))
            .expect("should write a gitignore");
        assert_eq!(ignore.trim_end(), "*");
    }

    #[test]
    fn should_keep_existing_rows_when_the_same_vault_is_opened_again() {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();

        let first = db.open(vault.path()).expect("should open");
        insert_probe(&db, "a");
        let second = db.open(vault.path()).expect("should reopen");

        assert_eq!(first, VaultDbStatus::Ready { schema_version: 4 });
        assert_eq!(second, VaultDbStatus::Ready { schema_version: 4 });
        assert_eq!(probe(&db), Some("a".to_string()));
    }

    #[test]
    fn should_not_overwrite_a_gitignore_the_writer_customised() {
        let vault = tempdir().expect("should make a temp dir");
        fs::create_dir_all(data_dir(vault.path())).expect("should make the data dir");
        let ignore = data_dir(vault.path()).join(".gitignore");
        fs::write(&ignore, "*\n!notes.md\n").expect("should seed a gitignore");

        VaultDb::default().open(vault.path()).expect("should open");

        assert_eq!(
            fs::read_to_string(&ignore).expect("should still be readable"),
            "*\n!notes.md\n"
        );
    }

    #[test]
    fn should_see_no_data_from_the_previous_vault_after_switching() {
        let a = tempdir().expect("should make a temp dir");
        let b = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();

        db.open(a.path()).expect("should open a");
        insert_probe(&db, "a");
        db.open(b.path()).expect("should open b");

        assert_eq!(probe(&db), None);
    }

    #[test]
    fn should_report_unavailable_when_the_database_file_is_not_a_database() {
        let vault = tempdir().expect("should make a temp dir");
        fs::create_dir_all(data_dir(vault.path())).expect("should make the data dir");
        fs::write(db_path(vault.path()), b"not a database, just bytes").expect("should write");
        let db = VaultDb::default();

        let status = db.open(vault.path()).expect("should not be an Err");

        // The message carries SQLite's own words, not a generic stand-in: it is
        // the only thing the writer gets to act on.
        let VaultDbStatus::Unavailable { message } = status else {
            panic!("a corrupt database should be unavailable, not ready");
        };
        assert!(
            message.contains("schema version") && message.contains("not a database"),
            "should name the step and the cause, got {message:?}"
        );
        assert!(
            db.with(|_| ()).is_none(),
            "no connection should be left open"
        );
    }

    #[test]
    fn should_report_unavailable_when_the_data_directory_cannot_be_created() {
        let vault = tempdir().expect("should make a temp dir");
        // A file where the directory needs to go, so `create_dir_all` fails.
        fs::write(data_dir(vault.path()), b"in the way").expect("should write");
        let db = VaultDb::default();

        let status = db.open(vault.path()).expect("should not be an Err");

        let VaultDbStatus::Unavailable { message } = status else {
            panic!("an uncreatable data directory should be unavailable, not ready");
        };
        assert!(
            message.contains(".inkling"),
            "should name the path it failed on, got {message:?}"
        );
    }

    /// `bridge.ts` mirrors this shape by hand. If serde stops producing it, the
    /// frontend reads `undefined` and nothing else in either suite notices.
    #[test]
    fn serialises_to_the_shape_the_frontend_reads() {
        let ready = serde_json::to_string(&VaultDbStatus::Ready { schema_version: 2 })
            .expect("should serialise");
        let unavailable = serde_json::to_string(&VaultDbStatus::Unavailable {
            message: "file is not a database".to_string(),
        })
        .expect("should serialise");

        assert_eq!(ready, r#"{"kind":"ready","schemaVersion":2}"#);
        assert_eq!(
            unavailable,
            r#"{"kind":"unavailable","message":"file is not a database"}"#
        );
    }

    #[test]
    fn should_fail_when_the_vault_root_is_not_a_directory() {
        let vault = tempdir().expect("should make a temp dir");
        let file = vault.path().join("not-a-vault.md");
        fs::write(&file, "# hello\n").expect("should write");

        assert!(VaultDb::default().open(&file).is_err());
    }
}

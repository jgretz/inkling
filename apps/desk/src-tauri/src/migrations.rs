//! The vault database's schema history.
//!
//! Migrations are data, not code: each one is a `.sql` file under
//! `src-tauri/migrations/`, embedded at compile time and listed once in
//! [`MIGRATIONS`]. Adding one is a new `migrations/NNNN_name.sql`, one appended
//! entry here, and a line in the catalog test. A migration that has shipped is
//! never edited: vaults in the wild have already run it.
//!
//! The applied version is SQLite's own `PRAGMA user_version` rather than a
//! bookkeeping table, because it is transactional with the statements it
//! records and needs no schema of its own to exist first.

use rusqlite::Connection;

pub struct Migration {
    pub version: i32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "meta",
        sql: include_str!("../migrations/0001_meta.sql"),
    },
    Migration {
        version: 2,
        name: "voice_suppression",
        sql: include_str!("../migrations/0002_voice_suppression.sql"),
    },
    Migration {
        version: 3,
        name: "reference",
        sql: include_str!("../migrations/0003_reference.sql"),
    },
];

/// Applies every migration the database has not seen, returning the version it
/// ends on.
///
/// Each migration's statements and the `user_version` bump share a transaction,
/// so a failure part way through leaves the database on the version it started
/// at rather than half-migrated. Errors name the migration that failed, because
/// this message is what the writer eventually reads in the status bar.
pub fn migrate(conn: &mut Connection) -> Result<i32, String> {
    let mut version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("reading the schema version: {error}"))?;

    for migration in MIGRATIONS {
        if migration.version <= version {
            continue;
        }
        let failed = |error: rusqlite::Error| {
            format!(
                "migration {} ({}): {error}",
                migration.version, migration.name
            )
        };
        let tx = conn.transaction().map_err(failed)?;
        tx.execute_batch(migration.sql).map_err(failed)?;
        tx.pragma_update(None, "user_version", migration.version)
            .map_err(failed)?;
        tx.commit().map_err(failed)?;
        version = migration.version;
    }

    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::{migrate, MIGRATIONS};
    use rusqlite::Connection;

    #[test]
    fn catalog_lists_every_shipped_migration() {
        let catalog: Vec<(i32, &str)> = MIGRATIONS.iter().map(|m| (m.version, m.name)).collect();

        // Appending a migration updates this line on purpose: the catalog is
        // the one place a reviewer can see the whole schema history.
        assert_eq!(
            catalog,
            vec![(1, "meta"), (2, "voice_suppression"), (3, "reference")]
        );
    }

    #[test]
    fn versions_start_at_one_and_strictly_ascend() {
        let versions: Vec<i32> = MIGRATIONS.iter().map(|m| m.version).collect();

        assert_eq!(versions.first(), Some(&1));
        assert!(versions.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn migrate_is_idempotent_on_an_already_current_database() {
        let mut conn = Connection::open_in_memory().expect("should open in memory");

        let first = migrate(&mut conn).expect("should migrate");
        let second = migrate(&mut conn).expect("should re-run without applying anything");

        assert_eq!(first, 3);
        assert_eq!(second, 3);
    }
}

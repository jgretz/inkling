//! Dismissed voice findings.
//!
//! A dismissal is stored against the finding's anchor, never its offsets, so it
//! follows the sentence it belongs to when the prose above is rewritten. The
//! matching itself is pure and lives in `@inkling/voice`; this file only keeps
//! the rows.
//!
//! Rows are kept until the writer restores them. There is no sweep for anchors
//! that no longer resolve: a row costs a couple of hundred bytes, and anything
//! keyed on "this document is gone" would destroy dismissals the first time a
//! writer renamed a folder in Finder.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::data::VaultDb;

/// One dismissal, as the frontend reads it.
///
/// The serialised shape is a contract with `StoredSuppression` in
/// `src/lib/bridge.ts`, a hand-written mirror rather than a generated one, so
/// `serialises_to_the_shape_the_frontend_reads` pins it. Tauri camel-cases
/// command parameters on the way in as well: `doc_path` here is `docPath` in
/// the `invoke` call.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suppression {
    pub id: i64,
    pub doc_path: String,
    pub rule_id: String,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub hint: i64,
    pub created_at: String,
}

/// What a command says when no vault database is open.
///
/// Named rather than blank: the frontend logs this, and "no vault database is
/// open" is the difference between a bug and a writer who has not chosen a
/// vault yet.
const NO_CONNECTION: &str = "no vault database is open, so dismissals cannot be read or written";

const COLUMNS: &str = "id, doc_path, rule_id, quote, prefix, suffix, hint, created_at";

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Suppression> {
    Ok(Suppression {
        id: row.get(0)?,
        doc_path: row.get(1)?,
        rule_id: row.get(2)?,
        quote: row.get(3)?,
        prefix: row.get(4)?,
        suffix: row.get(5)?,
        hint: row.get(6)?,
        created_at: row.get(7)?,
    })
}

pub(crate) fn select_for_doc(
    conn: &Connection,
    doc_path: &str,
) -> rusqlite::Result<Vec<Suppression>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM voice_suppression WHERE doc_path = ?1 ORDER BY created_at, id"
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([doc_path], row)?;
    rows.collect()
}

/// Inserts a dismissal, then reads back the row that now holds it.
///
/// `ON CONFLICT DO NOTHING` rather than an existence check: the unique index
/// over the anchor is what makes dismissing the same finding twice idempotent,
/// and a check-then-insert would leave a window between the two. The row is
/// selected afterwards either way, so the caller gets the same answer whether
/// this insert or an earlier one created it.
pub(crate) fn insert(
    conn: &Connection,
    doc_path: &str,
    rule_id: &str,
    quote: &str,
    prefix: &str,
    suffix: &str,
    hint: i64,
) -> rusqlite::Result<Suppression> {
    conn.execute(
        "INSERT INTO voice_suppression (doc_path, rule_id, quote, prefix, suffix, hint, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (doc_path, rule_id, quote, prefix, suffix) DO NOTHING",
        rusqlite::params![doc_path, rule_id, quote, prefix, suffix, hint],
    )?;

    let sql = format!(
        "SELECT {COLUMNS} FROM voice_suppression
         WHERE doc_path = ?1 AND rule_id = ?2 AND quote = ?3 AND prefix = ?4 AND suffix = ?5"
    );
    conn.query_row(
        &sql,
        rusqlite::params![doc_path, rule_id, quote, prefix, suffix],
        row,
    )
}

#[tauri::command]
pub fn list_suppressions(
    doc_path: String,
    db: State<'_, VaultDb>,
) -> Result<Vec<Suppression>, String> {
    db.with(|conn| select_for_doc(conn, &doc_path))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("listing dismissals for {doc_path}: {error}"))
}

#[tauri::command]
pub fn add_suppression(
    doc_path: String,
    rule_id: String,
    quote: String,
    prefix: String,
    suffix: String,
    hint: i64,
    db: State<'_, VaultDb>,
) -> Result<Suppression, String> {
    db.with(|conn| insert(conn, &doc_path, &rule_id, &quote, &prefix, &suffix, hint))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("dismissing {rule_id} in {doc_path}: {error}"))
}

#[tauri::command]
pub fn remove_suppression(id: i64, db: State<'_, VaultDb>) -> Result<(), String> {
    db.with(|conn| conn.execute("DELETE FROM voice_suppression WHERE id = ?1", [id]))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map(|_| ())
        .map_err(|error| format!("restoring dismissal {id}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{insert, select_for_doc, Suppression};
    use crate::data::VaultDb;
    use tempfile::tempdir;

    /// A vault with its database open, which is every test here.
    fn open_vault() -> (tempfile::TempDir, VaultDb) {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();
        db.open(vault.path()).expect("should open");
        (vault, db)
    }

    fn dismiss(db: &VaultDb, doc_path: &str, quote: &str, hint: i64) -> Suppression {
        db.with(|conn| insert(conn, doc_path, "em-dash", quote, "before ", " after", hint))
            .expect("a vault should be open")
            .expect("should insert")
    }

    fn listed(db: &VaultDb, doc_path: &str) -> Vec<Suppression> {
        db.with(|conn| select_for_doc(conn, doc_path))
            .expect("a vault should be open")
            .expect("should select")
    }

    #[test]
    fn should_not_return_another_documents_dismissals() {
        let (_vault, db) = open_vault();

        dismiss(&db, "a.md", "—", 12);

        assert_eq!(listed(&db, "b.md").len(), 0);
        assert_eq!(listed(&db, "a.md").len(), 1);
    }

    #[test]
    fn should_keep_one_row_when_the_same_finding_is_dismissed_twice() {
        let (_vault, db) = open_vault();

        let first = dismiss(&db, "a.md", "—", 12);
        // A different hint, which is what a re-dismissal after an edit above
        // the quote actually looks like. The anchor is the same passage, so
        // this is the same dismissal.
        let second = dismiss(&db, "a.md", "—", 340);

        assert_eq!(listed(&db, "a.md").len(), 1);
        assert_eq!(second.id, first.id);
        assert_eq!(second.hint, 12);
    }

    #[test]
    fn should_tell_two_anchors_in_one_document_apart() {
        let (_vault, db) = open_vault();

        dismiss(&db, "a.md", "—", 12);
        dismiss(&db, "a.md", "- ", 40);

        assert_eq!(listed(&db, "a.md").len(), 2);
    }

    #[test]
    fn should_stop_listing_a_dismissal_once_it_is_removed() {
        let (_vault, db) = open_vault();
        let row = dismiss(&db, "a.md", "—", 12);

        let removed = db
            .with(|conn| conn.execute("DELETE FROM voice_suppression WHERE id = ?1", [row.id]))
            .expect("a vault should be open")
            .expect("should delete");

        assert_eq!(removed, 1);
        assert_eq!(listed(&db, "a.md").len(), 0);
    }

    #[test]
    fn should_record_a_created_at_in_the_projects_timestamp_format() {
        let (_vault, db) = open_vault();

        let row = dismiss(&db, "a.md", "—", 12);

        // ISO 8601 UTC, the same `strftime` form `0001_meta.sql` uses.
        assert_eq!(row.created_at.len(), 24, "got {:?}", row.created_at);
        assert!(row.created_at.ends_with('Z'), "got {:?}", row.created_at);
    }

    /// `bridge.ts` mirrors this shape by hand. If serde stops producing it, the
    /// frontend reads `undefined` and nothing else in either suite notices.
    #[test]
    fn serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&Suppression {
            id: 7,
            doc_path: "drafts/a.md".to_string(),
            rule_id: "em-dash".to_string(),
            quote: "—".to_string(),
            prefix: "before ".to_string(),
            suffix: " after".to_string(),
            hint: 12,
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r#"{"id":7,"docPath":"drafts/a.md","ruleId":"em-dash","quote":"—","prefix":"before ","suffix":" after","hint":12,"createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }
}

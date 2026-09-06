//! Revisions: a document kept as it stood, because the writer said so.
//!
//! One menu item takes one, and nothing else ever does. There is no snapshot on
//! save, on close, on a timer or on an agent turn, which is what separates this
//! from `turn.snapshot` in `conversations.rs`: that one is written for every
//! turn and covers what the agent was looking at, while a revision covers what
//! the writer thought was worth coming back to.
//!
//! It is also the row in this database the writer is offered back. A dismissal
//! or a reference describes prose that is still in the vault; a revision *is*
//! prose, and the file it came from has since been rewritten. `turn.snapshot`
//! next door holds a whole document too, but nothing reads it and nothing hands
//! it to anyone, so a revision is the first thing here a writer is invited to
//! rely on. `docs/model.md` names it as the exception to everything under
//! `.inkling/` being regenerable, so deleting that directory now costs the
//! writer something.
//!
//! Two shapes cross the boundary rather than one. Listing a document's revisions
//! carries no `source`: a long article snapshotted forty times would otherwise
//! re-serialise megabytes of prose every time the document was opened, to render
//! a column of timestamps.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::data::VaultDb;

/// One revision without its text, which is all a list needs.
///
/// The serialised shape is a contract with `RevisionSummary` in
/// `src/lib/revisions.ts`, a hand-written mirror rather than a generated one, so
/// `serialises_to_the_shape_the_frontend_reads` pins it.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSummary {
    pub id: i64,
    pub doc_path: String,
    pub created_at: String,
}

/// One revision with the document it holds, fetched when the writer opens it.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: i64,
    pub doc_path: String,
    /// The whole document, frontmatter block and body together.
    pub source: String,
    pub created_at: String,
}

/// What a command says when no vault database is open.
///
/// Named rather than blank, the way `conversations.rs`'s is: the frontend logs
/// this, and "no vault database is open" is the difference between a bug and a
/// writer who has not chosen a vault yet.
const NO_CONNECTION: &str = "no vault database is open, so revisions cannot be read or written";

const SUMMARY_COLUMNS: &str = "id, doc_path, created_at";

const COLUMNS: &str = "id, doc_path, source, created_at";

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

fn summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RevisionSummary> {
    Ok(RevisionSummary {
        id: row.get(0)?,
        doc_path: row.get(1)?,
        created_at: row.get(2)?,
    })
}

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Revision> {
    Ok(Revision {
        id: row.get(0)?,
        doc_path: row.get(1)?,
        source: row.get(2)?,
        created_at: row.get(3)?,
    })
}

/// Every revision of one document, newest first, which is reading order here.
///
/// The opposite of `select_turns`: a conversation is read from the top, and a
/// writer looking for a version to go back to starts from the one they kept most
/// recently.
pub(crate) fn select_for(
    conn: &Connection,
    doc_path: &str,
) -> rusqlite::Result<Vec<RevisionSummary>> {
    let sql =
        format!("SELECT {SUMMARY_COLUMNS} FROM revision WHERE doc_path = ?1 ORDER BY id DESC");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([doc_path], summary_row)?;
    rows.collect()
}

/// Keeps a document as it stands, reading back the row it created.
///
/// Nothing is validated. An empty document is a document, and two snapshots of
/// identical text are two revisions: the writer asked twice, and the second ask
/// is not a mistake to be swallowed. See `0005_revision.sql` for why there is no
/// unique index behind that.
pub(crate) fn insert(
    conn: &Connection,
    doc_path: &str,
    source: &str,
) -> Result<RevisionSummary, String> {
    let sql = format!(
        "INSERT INTO revision (doc_path, source, created_at)
         VALUES (?1, ?2, {NOW})
         RETURNING {SUMMARY_COLUMNS}"
    );
    conn.query_row(&sql, rusqlite::params![doc_path, source], summary_row)
        .map_err(|error| format!("keeping a revision of {doc_path}: {error}"))
}

/// One revision with its text, for the panel that shows it.
pub(crate) fn select_one(conn: &Connection, id: i64) -> Result<Revision, String> {
    let sql = format!("SELECT {COLUMNS} FROM revision WHERE id = ?1");
    conn.query_row(&sql, [id], row)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => format!("no revision {id} to read"),
            other => format!("reading revision {id}: {other}"),
        })
}

#[tauri::command]
pub fn list_revisions(
    doc_path: String,
    db: State<'_, VaultDb>,
) -> Result<Vec<RevisionSummary>, String> {
    db.with(|conn| select_for(conn, &doc_path))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("listing revisions of {doc_path}: {error}"))
}

#[tauri::command]
pub fn create_revision(
    doc_path: String,
    source: String,
    db: State<'_, VaultDb>,
) -> Result<RevisionSummary, String> {
    db.with(|conn| insert(conn, &doc_path, &source))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

#[tauri::command]
pub fn read_revision(id: i64, db: State<'_, VaultDb>) -> Result<Revision, String> {
    db.with(|conn| select_one(conn, id))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{insert, select_for, select_one, Revision, RevisionSummary};
    use crate::data::VaultDb;
    use tempfile::tempdir;

    /// A vault with its database open, which is every test here.
    fn open_vault() -> (tempfile::TempDir, VaultDb) {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();
        db.open(vault.path()).expect("should open");
        (vault, db)
    }

    fn keep(db: &VaultDb, doc: &str, source: &str) -> RevisionSummary {
        db.with(|conn| insert(conn, doc, source))
            .expect("a vault should be open")
            .expect("should keep a revision")
    }

    fn listed(db: &VaultDb, doc: &str) -> Vec<RevisionSummary> {
        db.with(|conn| select_for(conn, doc))
            .expect("a vault should be open")
            .expect("should select")
    }

    fn read(db: &VaultDb, id: i64) -> Revision {
        db.with(|conn| select_one(conn, id))
            .expect("a vault should be open")
            .expect("should read")
    }

    /// Every row in the table, whatever document it belongs to. What "a document
    /// with no revisions costs nothing" is measured against.
    fn total(db: &VaultDb) -> i64 {
        db.with(|conn| {
            conn.query_row("SELECT COUNT(*) FROM revision", [], |row| {
                row.get::<_, i64>(0)
            })
        })
        .expect("a vault should be open")
        .expect("should count")
    }

    /// The whole document, not the body: restoring a revision that had lost its
    /// frontmatter would strip the document's kind, its title and its voice
    /// overrides in one click.
    #[test]
    fn should_keep_the_frontmatter_as_well_as_the_body_byte_for_byte() {
        let (_vault, db) = open_vault();
        let source = "---\ntitle: On endings\nkind: article\n---\n\n# On endings\n\nThe body.\n";

        let kept = keep(&db, "drafts/a.md", source);

        assert_eq!(read(&db, kept.id).source, source);
    }

    #[test]
    fn should_list_the_newest_revision_first() {
        let (_vault, db) = open_vault();
        keep(&db, "drafts/a.md", "# first");
        let second = keep(&db, "drafts/a.md", "# second");

        let ids: Vec<i64> = listed(&db, "drafts/a.md")
            .into_iter()
            .map(|revision| revision.id)
            .collect();

        assert_eq!(ids.first(), Some(&second.id));
        assert_eq!(ids.len(), 2);
    }

    /// Two clicks on identical text are two revisions. The second says the text
    /// in hand is still worth keeping, and nothing else records that.
    #[test]
    fn should_keep_two_snapshots_of_identical_text() {
        let (_vault, db) = open_vault();

        let first = keep(&db, "drafts/a.md", "# unchanged");
        let second = keep(&db, "drafts/a.md", "# unchanged");

        assert_ne!(second.id, first.id);
        assert_eq!(listed(&db, "drafts/a.md").len(), 2);
    }

    #[test]
    fn should_list_only_the_revisions_of_one_document() {
        let (_vault, db) = open_vault();
        keep(&db, "drafts/a.md", "# a");
        keep(&db, "drafts/b.md", "# b");

        assert_eq!(listed(&db, "drafts/a.md").len(), 1);
        assert_eq!(read(&db, listed(&db, "drafts/a.md")[0].id).source, "# a");
    }

    /// A vault nobody has snapshotted in holds no rows at all, so a document
    /// that never takes a revision costs the writer nothing.
    #[test]
    fn should_cost_nothing_for_a_document_that_was_never_snapshotted() {
        let (_vault, db) = open_vault();

        assert_eq!(listed(&db, "drafts/a.md"), vec![]);
        assert_eq!(total(&db), 0);
    }

    /// An empty document is a document. Refusing here would mean the one gesture
    /// that says "keep this" silently does nothing on a draft just started.
    #[test]
    fn should_keep_a_revision_of_an_empty_document() {
        let (_vault, db) = open_vault();

        let kept = keep(&db, "drafts/a.md", "");

        assert_eq!(read(&db, kept.id).source, "");
    }

    #[test]
    fn should_refuse_to_read_a_revision_that_is_not_there() {
        let (_vault, db) = open_vault();

        let result = db
            .with(|conn| select_one(conn, 404))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("no revision 404")));
    }

    #[test]
    fn should_record_timestamps_in_the_projects_format() {
        let (_vault, db) = open_vault();

        let kept = keep(&db, "drafts/a.md", "# a");

        // ISO 8601 UTC, the same `strftime` form `0001_meta.sql` uses. The
        // library's `relativeTime` parses this string, so a drift here reads on
        // screen as a revision with no date at all.
        assert_eq!(kept.created_at.len(), 24, "got {:?}", kept.created_at);
        assert!(kept.created_at.ends_with('Z'), "got {:?}", kept.created_at);
    }

    /// `src/lib/revisions.ts` mirrors these shapes by hand. If serde stops
    /// producing them, the frontend reads `undefined` and nothing else in either
    /// suite notices.
    #[test]
    fn serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&RevisionSummary {
            id: 7,
            doc_path: "drafts/a.md".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r#"{"id":7,"docPath":"drafts/a.md","createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }

    #[test]
    fn a_read_revision_serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&Revision {
            id: 7,
            doc_path: "drafts/a.md".to_string(),
            source: "# On endings".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r##"{"id":7,"docPath":"drafts/a.md","source":"# On endings","createdAt":"2026-01-01T00:00:00.000Z"}"##
        );
    }
}

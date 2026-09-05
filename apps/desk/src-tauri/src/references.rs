//! References: what a document or a group carries into a turn besides prose.
//!
//! Three kinds, one table. A `doc` names another document in the vault, a
//! `note` names a markdown file inkling wrote for the writer, and a `link`
//! names a URL. Nothing here fetches anything: a link is a title and an
//! address, and retrieval is a later roadmap item.
//!
//! Owner columns are mutually exclusive by CHECK rather than folded into one
//! `owner_path`, for the reason `0003_reference.sql` gives: `paths.rs` rewrites
//! a column, not a row, so a column has to hold one kind of path.
//!
//! The whole table crosses the boundary in one call. A vault holds tens of
//! these, `list_docs` already loads every document's body for the same reason,
//! and the ancestor walk that decides which of them reach a given document is
//! pure TypeScript in `src/lib/references.ts`.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::data::VaultDb;

/// One reference, as the frontend reads it.
///
/// The serialised shape is a contract with `StoredReference` in
/// `src/lib/references.ts`, a hand-written mirror rather than a generated one,
/// so `serialises_to_the_shape_the_frontend_reads` pins it. The unset columns
/// cross as `null`, which is what the mirror's `string | null` fields say.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: i64,
    pub doc_path: Option<String>,
    pub group_path: Option<String>,
    pub kind: String,
    pub target_path: Option<String>,
    pub url: Option<String>,
    pub title: String,
    pub created_at: String,
}

/// One inherited reference a document turned off, as the frontend reads it.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSuppression {
    pub id: i64,
    pub doc_path: String,
    pub reference_id: i64,
    pub created_at: String,
}

/// What a command says when no vault database is open.
///
/// Named rather than blank, the way `voice.rs`'s is: the frontend logs this,
/// and "no vault database is open" is the difference between a bug and a writer
/// who has not chosen a vault yet.
const NO_CONNECTION: &str = "no vault database is open, so references cannot be read or written";

const KINDS: [&str; 3] = ["doc", "link", "note"];

const COLUMNS: &str = "id, doc_path, group_path, kind, target_path, url, title, created_at";

const SUPPRESSION_COLUMNS: &str = "id, doc_path, reference_id, created_at";

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reference> {
    Ok(Reference {
        id: row.get(0)?,
        doc_path: row.get(1)?,
        group_path: row.get(2)?,
        kind: row.get(3)?,
        target_path: row.get(4)?,
        url: row.get(5)?,
        title: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn suppression_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReferenceSuppression> {
    Ok(ReferenceSuppression {
        id: row.get(0)?,
        doc_path: row.get(1)?,
        reference_id: row.get(2)?,
        created_at: row.get(3)?,
    })
}

/// A reference as the boundary receives it, before anything reaches SQL.
///
/// A struct rather than six positional arguments so [`validate`] can be read
/// beside the CHECKs it mirrors. The refusals are named, because each one is a
/// different mistake and the frontend logs the message.
pub(crate) struct NewReference<'a> {
    pub doc_path: Option<&'a str>,
    pub group_path: Option<&'a str>,
    pub kind: &'a str,
    pub target_path: Option<&'a str>,
    pub url: Option<&'a str>,
    pub title: &'a str,
}

impl NewReference<'_> {
    /// The same rules the table's CHECKs enforce, refused here with a sentence.
    ///
    /// Checked twice on purpose: the constraint is what makes the rule true of
    /// every row ever written, and this is what makes a broken call say which
    /// rule it broke instead of "CHECK constraint failed".
    fn validate(&self) -> Result<(), String> {
        match (self.doc_path, self.group_path) {
            (Some(_), Some(_)) => {
                return Err("a reference belongs to a document or to a group, not both".to_string())
            }
            (None, None) => return Err("a reference needs an owning document or group".to_string()),
            _ => {}
        }
        if !KINDS.contains(&self.kind) {
            return Err(format!(
                "unknown reference kind {}: expected one of {}",
                self.kind,
                KINDS.join(", ")
            ));
        }
        if self.title.trim().is_empty() {
            return Err("a reference needs a title".to_string());
        }
        if self.kind == "link" {
            if self.url.is_none() {
                return Err("a link reference needs a url".to_string());
            }
            if self.target_path.is_some() {
                return Err("a link reference has a url, not a target path".to_string());
            }
        } else {
            if self.target_path.is_none() {
                return Err(format!("a {} reference needs a target path", self.kind));
            }
            if self.url.is_some() {
                return Err(format!(
                    "a {} reference has a target path, not a url",
                    self.kind
                ));
            }
        }
        Ok(())
    }
}

/// Every reference in the vault, oldest first.
///
/// No filter argument: which of these reach a given document is the cascade,
/// and the cascade is assembled on the frontend out of the paths.
pub(crate) fn select_all(conn: &Connection) -> rusqlite::Result<Vec<Reference>> {
    let sql = format!("SELECT {COLUMNS} FROM reference ORDER BY id");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], row)?;
    rows.collect()
}

/// Inserts a reference, then reads back the row that now holds it.
///
/// `ON CONFLICT DO NOTHING` with no conflict target, because the unique index
/// is over expressions and cannot be named as one. The effect is the one
/// `voice.rs::insert` relies on: attaching the same reference twice is
/// idempotent and both calls return the row that holds it.
pub(crate) fn insert(conn: &Connection, new: &NewReference<'_>) -> Result<Reference, String> {
    new.validate()?;

    let named = |error: rusqlite::Error| format!("attaching {}: {error}", new.title);

    conn.execute(
        "INSERT INTO reference (doc_path, group_path, kind, target_path, url, title, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT DO NOTHING",
        rusqlite::params![
            new.doc_path,
            new.group_path,
            new.kind,
            new.target_path,
            new.url,
            new.title
        ],
    )
    .map_err(named)?;

    let sql = format!(
        "SELECT {COLUMNS} FROM reference
         WHERE COALESCE(doc_path, '') = ?1 AND COALESCE(group_path, '') = ?2
           AND kind = ?3 AND COALESCE(target_path, url) = ?4"
    );
    conn.query_row(
        &sql,
        rusqlite::params![
            new.doc_path.unwrap_or(""),
            new.group_path.unwrap_or(""),
            new.kind,
            new.target_path.or(new.url).unwrap_or("")
        ],
        row,
    )
    .map_err(named)
}

pub(crate) fn delete(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM reference WHERE id = ?1", [id])
}

/// Every suppression in the vault, oldest first.
pub(crate) fn select_all_suppressions(
    conn: &Connection,
) -> rusqlite::Result<Vec<ReferenceSuppression>> {
    let sql = format!("SELECT {SUPPRESSION_COLUMNS} FROM reference_suppression ORDER BY id");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], suppression_row)?;
    rows.collect()
}

/// Turns one inherited reference off for one document.
///
/// Refuses a reference the document owns itself. Detaching your own reference
/// is deleting it, and a row here saying the same thing would leave two ways to
/// undo one attachment and no answer for which of them the writer meant.
pub(crate) fn insert_suppression(
    conn: &Connection,
    doc_path: &str,
    reference_id: i64,
) -> Result<ReferenceSuppression, String> {
    let named = |error: rusqlite::Error| format!("turning off reference {reference_id}: {error}");

    let owner: Option<String> = conn
        .query_row(
            "SELECT group_path FROM reference WHERE id = ?1",
            [reference_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("no reference {reference_id} to turn off")
            }
            other => named(other),
        })?;

    if owner.is_none() {
        return Err(format!(
            "reference {reference_id} belongs to a document, so it is detached rather than turned off"
        ));
    }

    conn.execute(
        "INSERT INTO reference_suppression (doc_path, reference_id, created_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (doc_path, reference_id) DO NOTHING",
        rusqlite::params![doc_path, reference_id],
    )
    .map_err(named)?;

    let sql = format!(
        "SELECT {SUPPRESSION_COLUMNS} FROM reference_suppression
         WHERE doc_path = ?1 AND reference_id = ?2"
    );
    conn.query_row(
        &sql,
        rusqlite::params![doc_path, reference_id],
        suppression_row,
    )
    .map_err(named)
}

pub(crate) fn delete_suppression(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM reference_suppression WHERE id = ?1", [id])
}

#[tauri::command]
pub fn list_references(db: State<'_, VaultDb>) -> Result<Vec<Reference>, String> {
    db.with(select_all)
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("listing references: {error}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_reference(
    doc_path: Option<String>,
    group_path: Option<String>,
    kind: String,
    target_path: Option<String>,
    url: Option<String>,
    title: String,
    db: State<'_, VaultDb>,
) -> Result<Reference, String> {
    let new = NewReference {
        doc_path: doc_path.as_deref(),
        group_path: group_path.as_deref(),
        kind: &kind,
        target_path: target_path.as_deref(),
        url: url.as_deref(),
        title: &title,
    };
    db.with(|conn| insert(conn, &new))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

/// Removing a reference sweeps the suppressions filed against it, through the
/// cascade the table declares. The note's markdown file, if it had one, stays:
/// the row is inkling's, the prose is the writer's.
#[tauri::command]
pub fn remove_reference(id: i64, db: State<'_, VaultDb>) -> Result<(), String> {
    db.with(|conn| delete(conn, id))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map(|_| ())
        .map_err(|error| format!("detaching reference {id}: {error}"))
}

#[tauri::command]
pub fn list_reference_suppressions(
    db: State<'_, VaultDb>,
) -> Result<Vec<ReferenceSuppression>, String> {
    db.with(select_all_suppressions)
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("listing turned-off references: {error}"))
}

#[tauri::command]
pub fn add_reference_suppression(
    doc_path: String,
    reference_id: i64,
    db: State<'_, VaultDb>,
) -> Result<ReferenceSuppression, String> {
    db.with(|conn| insert_suppression(conn, &doc_path, reference_id))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

#[tauri::command]
pub fn remove_reference_suppression(id: i64, db: State<'_, VaultDb>) -> Result<(), String> {
    db.with(|conn| delete_suppression(conn, id))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map(|_| ())
        .map_err(|error| format!("restoring reference {id}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        delete, insert, insert_suppression, select_all, select_all_suppressions, NewReference,
        Reference,
    };
    use crate::data::VaultDb;
    use tempfile::tempdir;

    /// A vault with its database open, which is every test here.
    fn open_vault() -> (tempfile::TempDir, VaultDb) {
        let vault = tempdir().expect("should make a temp dir");
        let db = VaultDb::default();
        db.open(vault.path()).expect("should open");
        (vault, db)
    }

    fn attach(db: &VaultDb, new: &NewReference<'_>) -> Result<Reference, String> {
        db.with(|conn| insert(conn, new))
            .expect("a vault should be open")
    }

    fn doc_reference<'a>(owner: &'a str, target: &'a str) -> NewReference<'a> {
        NewReference {
            doc_path: Some(owner),
            group_path: None,
            kind: "doc",
            target_path: Some(target),
            url: None,
            title: "Notes on endings",
        }
    }

    fn group_link<'a>(owner: &'a str, url: &'a str) -> NewReference<'a> {
        NewReference {
            doc_path: None,
            group_path: Some(owner),
            kind: "link",
            target_path: None,
            url: Some(url),
            title: "The style guide",
        }
    }

    fn listed(db: &VaultDb) -> Vec<Reference> {
        db.with(select_all)
            .expect("a vault should be open")
            .expect("should select")
    }

    #[test]
    fn should_read_back_a_reference_it_just_stored() {
        let (_vault, db) = open_vault();

        let stored =
            attach(&db, &doc_reference("drafts/a.md", "notes/b.md")).expect("should attach");

        assert_eq!(stored.doc_path.as_deref(), Some("drafts/a.md"));
        assert_eq!(stored.group_path, None);
        assert_eq!(stored.kind, "doc");
        assert_eq!(stored.target_path.as_deref(), Some("notes/b.md"));
        assert_eq!(stored.url, None);
        assert_eq!(listed(&db).len(), 1);
    }

    #[test]
    fn should_store_a_group_reference_and_a_document_reference_side_by_side() {
        let (_vault, db) = open_vault();

        attach(&db, &group_link("drafts", "https://example.com")).expect("should attach");
        attach(&db, &doc_reference("drafts/a.md", "notes/b.md")).expect("should attach");

        let all = listed(&db);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].group_path.as_deref(), Some("drafts"));
        assert_eq!(all[1].doc_path.as_deref(), Some("drafts/a.md"));
    }

    #[test]
    fn should_keep_one_row_when_the_same_reference_is_attached_twice() {
        let (_vault, db) = open_vault();

        let first =
            attach(&db, &group_link("drafts", "https://example.com")).expect("should attach");
        let second =
            attach(&db, &group_link("drafts", "https://example.com")).expect("should attach again");

        assert_eq!(second.id, first.id);
        assert_eq!(listed(&db).len(), 1);
    }

    #[test]
    fn should_refuse_a_reference_owned_by_both_a_document_and_a_group() {
        let (_vault, db) = open_vault();

        let result = attach(
            &db,
            &NewReference {
                doc_path: Some("drafts/a.md"),
                group_path: Some("drafts"),
                kind: "doc",
                target_path: Some("notes/b.md"),
                url: None,
                title: "Both",
            },
        );

        assert!(result.is_err_and(|error| error.contains("not both")),);
        assert_eq!(listed(&db).len(), 0);
    }

    #[test]
    fn should_refuse_a_reference_owned_by_neither() {
        let (_vault, db) = open_vault();

        let result = attach(
            &db,
            &NewReference {
                doc_path: None,
                group_path: None,
                kind: "link",
                target_path: None,
                url: Some("https://example.com"),
                title: "Nobody's",
            },
        );

        assert!(result.is_err_and(|error| error.contains("owning document or group")));
    }

    #[test]
    fn should_refuse_a_kind_it_does_not_know() {
        let (_vault, db) = open_vault();

        let result = attach(
            &db,
            &NewReference {
                doc_path: Some("a.md"),
                group_path: None,
                kind: "pdf",
                target_path: Some("b.md"),
                url: None,
                title: "A paper",
            },
        );

        assert!(result.is_err_and(|error| error.contains("pdf")));
    }

    #[test]
    fn should_refuse_a_link_with_no_url_and_a_doc_with_no_target() {
        let (_vault, db) = open_vault();

        let link = attach(
            &db,
            &NewReference {
                doc_path: Some("a.md"),
                group_path: None,
                kind: "link",
                target_path: None,
                url: None,
                title: "A link to nowhere",
            },
        );
        let doc = attach(
            &db,
            &NewReference {
                doc_path: Some("a.md"),
                group_path: None,
                kind: "doc",
                target_path: None,
                url: None,
                title: "A document that is not named",
            },
        );

        assert!(link.is_err_and(|error| error.contains("needs a url")));
        assert!(doc.is_err_and(|error| error.contains("needs a target path")));
    }

    #[test]
    fn should_refuse_a_note_carrying_a_url() {
        let (_vault, db) = open_vault();

        let result = attach(
            &db,
            &NewReference {
                doc_path: Some("a.md"),
                group_path: None,
                kind: "note",
                target_path: Some("references/a-note.md"),
                url: Some("https://example.com"),
                title: "A note that is also a link",
            },
        );

        assert!(result.is_err_and(|error| error.contains("not a url")));
    }

    #[test]
    fn should_refuse_a_reference_with_no_title() {
        let (_vault, db) = open_vault();

        let result = attach(
            &db,
            &NewReference {
                doc_path: Some("a.md"),
                group_path: None,
                kind: "link",
                target_path: None,
                url: Some("https://example.com"),
                title: "   ",
            },
        );

        assert!(result.is_err_and(|error| error.contains("needs a title")));
    }

    #[test]
    fn should_stop_listing_a_reference_once_it_is_removed() {
        let (_vault, db) = open_vault();
        let stored = attach(&db, &doc_reference("a.md", "b.md")).expect("should attach");

        let removed = db
            .with(|conn| delete(conn, stored.id))
            .expect("a vault should be open")
            .expect("should delete");

        assert_eq!(removed, 1);
        assert_eq!(listed(&db).len(), 0);
    }

    #[test]
    fn should_record_a_created_at_in_the_projects_timestamp_format() {
        let (_vault, db) = open_vault();

        let stored = attach(&db, &doc_reference("a.md", "b.md")).expect("should attach");

        // ISO 8601 UTC, the same `strftime` form `0001_meta.sql` uses.
        assert_eq!(stored.created_at.len(), 24, "got {:?}", stored.created_at);
        assert!(
            stored.created_at.ends_with('Z'),
            "got {:?}",
            stored.created_at
        );
    }

    #[test]
    fn should_turn_off_an_inherited_reference_for_one_document() {
        let (_vault, db) = open_vault();
        let inherited = attach(&db, &group_link("drafts", "https://example.com")).expect("attach");

        let off = db
            .with(|conn| insert_suppression(conn, "drafts/a.md", inherited.id))
            .expect("a vault should be open")
            .expect("should suppress");

        let all = db
            .with(select_all_suppressions)
            .expect("a vault should be open")
            .expect("should select");
        assert_eq!(off.reference_id, inherited.id);
        assert_eq!(off.doc_path, "drafts/a.md");
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn should_keep_one_row_when_the_same_reference_is_turned_off_twice() {
        let (_vault, db) = open_vault();
        let inherited = attach(&db, &group_link("drafts", "https://example.com")).expect("attach");

        let first = db
            .with(|conn| insert_suppression(conn, "drafts/a.md", inherited.id))
            .expect("a vault should be open")
            .expect("should suppress");
        let second = db
            .with(|conn| insert_suppression(conn, "drafts/a.md", inherited.id))
            .expect("a vault should be open")
            .expect("should suppress again");

        assert_eq!(second.id, first.id);
    }

    /// A document's own reference is detached, not turned off. Two ways to undo
    /// one attachment is one way too many.
    #[test]
    fn should_refuse_to_turn_off_a_reference_the_document_owns() {
        let (_vault, db) = open_vault();
        let own = attach(&db, &doc_reference("drafts/a.md", "notes/b.md")).expect("attach");

        let result = db
            .with(|conn| insert_suppression(conn, "drafts/a.md", own.id))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("detached rather than turned off")));
    }

    #[test]
    fn should_refuse_to_turn_off_a_reference_that_is_not_there() {
        let (_vault, db) = open_vault();

        let result = db
            .with(|conn| insert_suppression(conn, "drafts/a.md", 404))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("no reference 404")));
    }

    /// The cascade the table declares: detaching the group's reference must not
    /// leave a row pointing at an id that no longer exists.
    #[test]
    fn should_sweep_a_suppression_when_its_reference_is_removed() {
        let (_vault, db) = open_vault();
        let inherited = attach(&db, &group_link("drafts", "https://example.com")).expect("attach");
        db.with(|conn| insert_suppression(conn, "drafts/a.md", inherited.id))
            .expect("a vault should be open")
            .expect("should suppress");

        db.with(|conn| delete(conn, inherited.id))
            .expect("a vault should be open")
            .expect("should delete");

        let all = db
            .with(select_all_suppressions)
            .expect("a vault should be open")
            .expect("should select");
        assert_eq!(all.len(), 0);
    }

    /// `src/lib/references.ts` mirrors this shape by hand. If serde stops
    /// producing it, the frontend reads `undefined` and nothing else in either
    /// suite notices.
    #[test]
    fn serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&Reference {
            id: 7,
            doc_path: None,
            group_path: Some("drafts".to_string()),
            kind: "link".to_string(),
            target_path: None,
            url: Some("https://example.com".to_string()),
            title: "The style guide".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r#"{"id":7,"docPath":null,"groupPath":"drafts","kind":"link","targetPath":null,"url":"https://example.com","title":"The style guide","createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }

    #[test]
    fn a_suppression_serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&super::ReferenceSuppression {
            id: 3,
            doc_path: "drafts/a.md".to_string(),
            reference_id: 7,
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r#"{"id":3,"docPath":"drafts/a.md","referenceId":7,"createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }
}

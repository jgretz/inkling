//! Following a stored path through a rename.
//!
//! Groups are directories, so a vault has no group table and nothing to keep in
//! step when one is renamed. What it does have is stored data keyed by a path,
//! and that has to move with the file or the writer loses it.
//!
//! There are two registries because there are two kinds of stored path, and a
//! column holds exactly one of them. [`PATH_KEYED`] lists the columns holding a
//! **document** path, [`GROUP_KEYED`] the columns holding a **group** path. The
//! difference is not cosmetic: renaming the group `drafts` moves everything
//! under `drafts/`, but the group column of a reference attached to `drafts`
//! holds the bare string `drafts`, which no prefix comparison against
//! `"drafts/"` will ever match. So the group columns take an exact match as
//! well as a prefix one, and a single-document rename leaves them alone
//! entirely: a document moving cannot change which group anything belongs to.
//!
//! Roadmap 4.2 (conversations) adds path-keyed tables too, and this is the file
//! they append to, so a rename keeps working without every caller learning the
//! new table's name.
//!
//! The matching is `substr`, never `LIKE`. `LIKE` reads `%` and `_` in its
//! pattern, so a group a writer named `50%_done` would match paths that have
//! nothing to do with it, and the rewrite would corrupt them.

use rusqlite::Transaction;

/// Every (table, column) pair holding a vault-relative document path.
pub const PATH_KEYED: &[(&str, &str)] = &[
    ("voice_suppression", "doc_path"),
    ("reference", "doc_path"),
    ("reference", "target_path"),
    ("reference_suppression", "doc_path"),
];

/// Every (table, column) pair holding a vault-relative group path.
pub const GROUP_KEYED: &[(&str, &str)] = &[("reference", "group_path")];

/// Deletes rows already stored at the target, then moves `from` onto `to`.
///
/// Rows already at the target are deleted first in both rewrites below. The
/// target does not exist on disk at that point, so those rows are orphans of an
/// earlier group or document by the same name; leaving them would fail the
/// rename on a unique index with a constraint error the writer cannot act on.
fn move_exact(
    tx: &Transaction<'_>,
    table: &str,
    column: &str,
    from: &str,
    to: &str,
) -> rusqlite::Result<()> {
    let delete = format!("DELETE FROM {table} WHERE {column} = ?1");
    tx.execute(&delete, [&to])?;

    let update = format!("UPDATE {table} SET {column} = ?1 WHERE {column} = ?2");
    tx.execute(&update, [&to, &from])?;
    Ok(())
}

/// The prefix half: everything stored under `from/` moves under `to/`.
fn move_under(
    tx: &Transaction<'_>,
    table: &str,
    column: &str,
    old: &str,
    new: &str,
) -> rusqlite::Result<()> {
    let delete = format!("DELETE FROM {table} WHERE substr({column}, 1, length(?1)) = ?1");
    tx.execute(&delete, [&new])?;

    // `length` is evaluated by SQLite over the same string it compares, so
    // the prefix's length is never computed twice in two encodings.
    let update = format!(
        "UPDATE {table} SET {column} = ?1 || substr({column}, length(?2) + 1)
         WHERE substr({column}, 1, length(?2)) = ?2"
    );
    tx.execute(&update, [&new, &old])?;
    Ok(())
}

/// Moves every stored path under the group `from` to sit under `to` instead.
///
/// Document columns take the prefix form only: a document path under a renamed
/// group is `drafts/a.md`, never `drafts`. Group columns take both, because the
/// renamed group is itself a value a group column can hold.
pub fn rewrite_prefix(tx: &Transaction<'_>, from: &str, to: &str) -> rusqlite::Result<()> {
    let old = format!("{from}/");
    let new = format!("{to}/");

    for (table, column) in PATH_KEYED {
        move_under(tx, table, column, &old, &new)?;
    }

    for (table, column) in GROUP_KEYED {
        move_exact(tx, table, column, from, to)?;
        move_under(tx, table, column, &old, &new)?;
    }
    Ok(())
}

/// Moves every stored path for one document to its new path.
///
/// [`PATH_KEYED`] only. A document rename must not touch a group column: the
/// groups are exactly where they were, and rewriting one would move a group's
/// references onto a path that is a document.
pub fn rewrite_exact(tx: &Transaction<'_>, from: &str, to: &str) -> rusqlite::Result<()> {
    for (table, column) in PATH_KEYED {
        move_exact(tx, table, column, from, to)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{GROUP_KEYED, PATH_KEYED};

    /// Asserted as a whole slice, the way `catalog_lists_every_shipped_migration`
    /// is: a table added later must be a deliberate edit here, because a
    /// path-keyed column left off this list silently stops following a rename.
    #[test]
    fn path_keyed_lists_every_column_holding_a_document_path() {
        assert_eq!(
            PATH_KEYED,
            &[
                ("voice_suppression", "doc_path"),
                ("reference", "doc_path"),
                ("reference", "target_path"),
                ("reference_suppression", "doc_path"),
            ]
        );
    }

    /// The same whole-slice assertion for the other registry. A group column
    /// listed here by mistake would be rewritten by a document rename's
    /// prefix pass; one left off stops following a group rename at all.
    #[test]
    fn group_keyed_lists_every_column_holding_a_group_path() {
        assert_eq!(GROUP_KEYED, &[("reference", "group_path")]);
    }
}

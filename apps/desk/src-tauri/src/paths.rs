//! Following a stored path through a rename, and sweeping it away on a delete.
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
//! Each entry also carries a [`Role`], which is a second and independent
//! question: does the path say *whose* row this is, or does it say what the row
//! points at? The two want opposite treatment at the destination, which is why
//! the role is stored rather than assumed. See [`Role`].
//!
//! A delete asks the registries the same question a rename does, and the role
//! answers it the other way round. A [`Role::Subject`] row belongs to the
//! document or group that has just gone, so it goes with it: that is what stops
//! a later document written at the same path inheriting a stranger's
//! dismissals, references, revisions and conversations. A [`Role::Pointer`]
//! column is left exactly as it was, because it names some *other* row's
//! subject: a reference aimed at a file the vault does not hold is kept and
//! shown broken on purpose, and a deleted target is precisely that case rather
//! than a row to sweep. See [`delete_exact`] and [`delete_prefix`].
//!
//! Every table keyed by a path appends here, so a rename and a delete keep
//! working without any caller learning the new table's name. `revision` is the
//! most recent to do so.
//!
//! The matching is `substr`, never `LIKE`. `LIKE` reads `%` and `_` in its
//! pattern, so a group a writer named `50%_done` would match paths that have
//! nothing to do with it, and the rewrite would corrupt them.

use rusqlite::Transaction;

/// What a stored path says about the row holding it.
///
/// The distinction decides what happens to rows already sitting at the
/// destination, and getting it wrong loses the writer's data quietly.
///
/// A [`Role::Subject`] column says whose row this is: a dismissal *of* this
/// document, a reference *belonging to* this group. The destination does not
/// exist on disk when a rename runs, so a row already filed there is an orphan
/// of a document or group that has gone. It is deleted, because leaving it
/// would fail the rename on a unique index with a constraint error the writer
/// cannot act on, and because reviving a dead document's dismissals under a
/// different document's name is not what anyone meant.
///
/// A [`Role::Pointer`] column says what the row points at, and identifies some
/// other row's subject rather than this one. A row filed there is not an
/// orphan: it is a live attachment naming a file the vault does not currently
/// hold, kept and shown as broken on purpose, and a rename putting a file back
/// at that path is exactly the moment it becomes whole again. So nothing is
/// deleted ahead of a pointer rewrite, and the unique index is settled by
/// `OR REPLACE` on the update instead, which touches only a row that genuinely
/// collides.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    Subject,
    Pointer,
}

use Role::{Pointer, Subject};

/// Every (table, column) pair holding a vault-relative document path.
pub const PATH_KEYED: &[(&str, &str, Role)] = &[
    ("voice_suppression", "doc_path", Subject),
    ("reference", "doc_path", Subject),
    ("reference", "target_path", Pointer),
    ("reference_suppression", "doc_path", Subject),
    ("conversation", "doc_path", Subject),
    ("revision", "doc_path", Subject),
];

/// Every (table, column) pair holding a vault-relative group path.
pub const GROUP_KEYED: &[(&str, &str, Role)] = &[("reference", "group_path", Subject)];

/// Moves `from` onto `to`, clearing the destination first for a subject column.
///
/// The update is `OR REPLACE` for both roles. A subject column cannot reach it,
/// because the delete above has already emptied the destination; a pointer
/// column relies on it, because two of one document's references can be pointed
/// at one file by a rename and only one row may say so.
fn move_exact(
    tx: &Transaction<'_>,
    table: &str,
    column: &str,
    role: Role,
    from: &str,
    to: &str,
) -> rusqlite::Result<()> {
    if role == Subject {
        let delete = format!("DELETE FROM {table} WHERE {column} = ?1");
        tx.execute(&delete, [&to])?;
    }

    let update = format!("UPDATE OR REPLACE {table} SET {column} = ?1 WHERE {column} = ?2");
    tx.execute(&update, [&to, &from])?;
    Ok(())
}

/// The prefix half: everything stored under `from/` moves under `to/`.
fn move_under(
    tx: &Transaction<'_>,
    table: &str,
    column: &str,
    role: Role,
    old: &str,
    new: &str,
) -> rusqlite::Result<()> {
    if role == Subject {
        let delete = format!("DELETE FROM {table} WHERE substr({column}, 1, length(?1)) = ?1");
        tx.execute(&delete, [&new])?;
    }

    // `length` is evaluated by SQLite over the same string it compares, so
    // the prefix's length is never computed twice in two encodings.
    let update = format!(
        "UPDATE OR REPLACE {table} SET {column} = ?1 || substr({column}, length(?2) + 1)
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

    for (table, column, role) in PATH_KEYED {
        move_under(tx, table, column, *role, &old, &new)?;
    }

    for (table, column, role) in GROUP_KEYED {
        move_exact(tx, table, column, *role, from, to)?;
        move_under(tx, table, column, *role, &old, &new)?;
    }
    Ok(())
}

/// Moves every stored path for one document to its new path.
///
/// [`PATH_KEYED`] only. A document rename must not touch a group column: the
/// groups are exactly where they were, and rewriting one would move a group's
/// references onto a path that is a document.
pub fn rewrite_exact(tx: &Transaction<'_>, from: &str, to: &str) -> rusqlite::Result<()> {
    for (table, column, role) in PATH_KEYED {
        move_exact(tx, table, column, *role, from, to)?;
    }
    Ok(())
}

/// Deletes every row a subject column files against `path`.
fn drop_exact(
    tx: &Transaction<'_>,
    table: &str,
    column: &str,
    role: Role,
    path: &str,
) -> rusqlite::Result<()> {
    if role == Pointer {
        return Ok(());
    }
    let delete = format!("DELETE FROM {table} WHERE {column} = ?1");
    tx.execute(&delete, [&path])?;
    Ok(())
}

/// The prefix half: every subject row filed under `prefix` goes.
fn drop_under(
    tx: &Transaction<'_>,
    table: &str,
    column: &str,
    role: Role,
    prefix: &str,
) -> rusqlite::Result<()> {
    if role == Pointer {
        return Ok(());
    }
    let delete = format!("DELETE FROM {table} WHERE substr({column}, 1, length(?1)) = ?1");
    tx.execute(&delete, [&prefix])?;
    Ok(())
}

/// Sweeps every stored row belonging to one deleted document.
///
/// [`PATH_KEYED`] only, and its subject columns only, for the two reasons the
/// module header gives: a document that has gone changes no group, and a
/// pointer aimed at it is a live attachment that is now broken rather than an
/// orphan.
///
/// A `reference` row deleted here takes its `reference_suppression` rows with
/// it, and a `conversation` row takes its `turn` rows, through the cascades
/// those tables declare.
pub fn delete_exact(tx: &Transaction<'_>, path: &str) -> rusqlite::Result<()> {
    for (table, column, role) in PATH_KEYED {
        drop_exact(tx, table, column, *role, path)?;
    }
    Ok(())
}

/// Sweeps every stored row belonging to a deleted group and to what was inside.
///
/// Document columns take the prefix form only: a document under the group is
/// `drafts/a.md`, never `drafts`. Group columns take both, because the deleted
/// group is itself a value a group column can hold, and a nested group under it
/// is one the prefix catches.
pub fn delete_prefix(tx: &Transaction<'_>, group: &str) -> rusqlite::Result<()> {
    let under = format!("{group}/");

    for (table, column, role) in PATH_KEYED {
        drop_under(tx, table, column, *role, &under)?;
    }

    for (table, column, role) in GROUP_KEYED {
        drop_exact(tx, table, column, *role, group)?;
        drop_under(tx, table, column, *role, &under)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Role::{Pointer, Subject};
    use super::{GROUP_KEYED, PATH_KEYED};

    /// Asserted as a whole slice, the way `catalog_lists_every_shipped_migration`
    /// is: a table added later must be a deliberate edit here, because a
    /// path-keyed column left off this list silently stops following a rename.
    /// The role is pinned along with the column, because a pointer column
    /// filed as a subject deletes live rows at the destination.
    #[test]
    fn path_keyed_lists_every_column_holding_a_document_path() {
        assert_eq!(
            PATH_KEYED,
            &[
                ("voice_suppression", "doc_path", Subject),
                ("reference", "doc_path", Subject),
                ("reference", "target_path", Pointer),
                ("reference_suppression", "doc_path", Subject),
                ("conversation", "doc_path", Subject),
                ("revision", "doc_path", Subject),
            ]
        );
    }

    /// The same whole-slice assertion for the other registry. A group column
    /// listed here by mistake would be rewritten by a document rename's
    /// prefix pass; one left off stops following a group rename at all.
    #[test]
    fn group_keyed_lists_every_column_holding_a_group_path() {
        assert_eq!(GROUP_KEYED, &[("reference", "group_path", Subject)]);
    }
}

//! Following a document path through a rename.
//!
//! Groups are directories, so a vault has no group table and nothing to keep in
//! step when one is renamed. What it does have is stored data keyed by a
//! document's path, and that has to move with the file or the writer loses it.
//!
//! [`PATH_KEYED`] is the list of columns holding such a path. It has one entry
//! today; roadmap 3.1 (references at group level) and 4.2 both add path-keyed
//! tables, and this is the file they append to, so a rename keeps working
//! without every caller learning the new table's name.
//!
//! The matching is `substr`, never `LIKE`. `LIKE` reads `%` and `_` in its
//! pattern, so a group a writer named `50%_done` would match paths that have
//! nothing to do with it, and the rewrite would corrupt them.

use rusqlite::Transaction;

/// Every (table, column) pair holding a vault-relative document path.
pub const PATH_KEYED: &[(&str, &str)] = &[("voice_suppression", "doc_path")];

/// Moves every stored path under the group `from` to sit under `to` instead.
///
/// Rows already stored under the target prefix are deleted first. The target
/// directory does not exist on disk at this point, so those rows are orphans of
/// an earlier group by the same name; leaving them would fail the rename on
/// `voice_suppression_anchor` with a constraint error the writer cannot act on.
pub fn rewrite_prefix(tx: &Transaction<'_>, from: &str, to: &str) -> rusqlite::Result<()> {
    let old = format!("{from}/");
    let new = format!("{to}/");

    for (table, column) in PATH_KEYED {
        let delete = format!("DELETE FROM {table} WHERE substr({column}, 1, length(?1)) = ?1");
        tx.execute(&delete, [&new])?;

        // `length` is evaluated by SQLite over the same string it compares, so
        // the prefix's length is never computed twice in two encodings.
        let update = format!(
            "UPDATE {table} SET {column} = ?1 || substr({column}, length(?2) + 1)
             WHERE substr({column}, 1, length(?2)) = ?2"
        );
        tx.execute(&update, [&new, &old])?;
    }
    Ok(())
}

/// Moves every stored path for one document to its new path.
///
/// Deletes rows already at the target for the same reason [`rewrite_prefix`]
/// does: the target file does not exist yet, so anything filed against it is
/// left over from a document that has gone.
pub fn rewrite_exact(tx: &Transaction<'_>, from: &str, to: &str) -> rusqlite::Result<()> {
    for (table, column) in PATH_KEYED {
        let delete = format!("DELETE FROM {table} WHERE {column} = ?1");
        tx.execute(&delete, [&to])?;

        let update = format!("UPDATE {table} SET {column} = ?1 WHERE {column} = ?2");
        tx.execute(&update, [&to, &from])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::PATH_KEYED;

    /// Asserted as a whole slice, the way `catalog_lists_every_shipped_migration`
    /// is: a table added later must be a deliberate edit here, because a
    /// path-keyed column left off this list silently stops following a rename.
    #[test]
    fn path_keyed_lists_every_column_holding_a_document_path() {
        assert_eq!(PATH_KEYED, &[("voice_suppression", "doc_path")]);
    }
}

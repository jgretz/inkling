//! Conversations and their turns: what was said about a document, kept.
//!
//! A document holds several conversations and a conversation holds one turn per
//! round trip. Neither is the writer's prose, so both live in
//! `.inkling/inkling.db` rather than in the vault, and deleting that directory
//! is still the whole recovery story.
//!
//! The live session on toryo's dispatch daemon is NOT stored data in the same
//! sense: `session_id` is a handle to a process that dies with the daemon, and
//! `resume_session_id` is what the next open passes so the new process inherits
//! the old one's history. A conversation whose session went is not damaged, it
//! is merely cold.
//!
//! A turn's `snapshot` is written and nothing reads it yet. It is the document
//! as it stood when the turn was asked, and it is the one column here that
//! cannot be reconstructed afterwards, because the writer keeps typing while the
//! agent answers.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::data::VaultDb;

/// One conversation, as the frontend reads it.
///
/// The serialised shape is a contract with `Conversation` in `src/lib/bridge.ts`,
/// a hand-written mirror rather than a generated one, so
/// `serialises_to_the_shape_the_frontend_reads` pins it. The unset session
/// columns cross as `null`, which is what the mirror's `string | null` says.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: i64,
    pub doc_path: String,
    pub title: String,
    pub session_id: Option<String>,
    pub resume_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One round trip, as the frontend reads it.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: i64,
    pub conversation_id: i64,
    pub asked: String,
    pub answered: Option<String>,
    pub state: String,
    pub snapshot: String,
    pub created_at: String,
}

/// What a command says when no vault database is open.
///
/// Named rather than blank, the way `references.rs`'s is: the frontend logs
/// this, and "no vault database is open" is the difference between a bug and a
/// writer who has not chosen a vault yet.
const NO_CONNECTION: &str = "no vault database is open, so conversations cannot be read or written";

/// Every state `0004_conversation.sql`'s CHECK admits, in lifecycle order.
const STATES: [&str; 4] = ["pending", "answered", "failed", "interrupted"];

/// The state a turn is born in, and the one [`finish`] may never move it back
/// to: doing so would drop the answer and leave the panel waiting on a stream
/// nobody is going to open.
const PENDING: &str = "pending";

/// The states a turn may be moved to once it has been asked.
///
/// Derived from [`STATES`] rather than listed a second time, so a state added to
/// the migration cannot be silently unreachable here, and one removed there
/// cannot linger here.
fn final_states() -> Vec<&'static str> {
    STATES
        .into_iter()
        .filter(|state| *state != PENDING)
        .collect()
}

const COLUMNS: &str = "id, doc_path, title, session_id, resume_session_id, created_at, updated_at";

const TURN_COLUMNS: &str = "id, conversation_id, asked, answered, state, snapshot, created_at";

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get(0)?,
        doc_path: row.get(1)?,
        title: row.get(2)?,
        session_id: row.get(3)?,
        resume_session_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn turn_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Turn> {
    Ok(Turn {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        asked: row.get(2)?,
        answered: row.get(3)?,
        state: row.get(4)?,
        snapshot: row.get(5)?,
        created_at: row.get(6)?,
    })
}

/// Every conversation about one document, oldest first.
pub(crate) fn select_for(conn: &Connection, doc_path: &str) -> rusqlite::Result<Vec<Conversation>> {
    let sql = format!("SELECT {COLUMNS} FROM conversation WHERE doc_path = ?1 ORDER BY id");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([doc_path], row)?;
    rows.collect()
}

/// Starts a conversation about a document, reading back the row it created.
///
/// Not idempotent, unlike `references.rs::insert`: a writer asking for a second
/// conversation about the same document with the same title means a second
/// conversation, and there is no other key to tell the two apart by.
pub(crate) fn insert(
    conn: &Connection,
    doc_path: &str,
    title: &str,
) -> Result<Conversation, String> {
    if title.trim().is_empty() {
        return Err("a conversation needs a title".to_string());
    }

    let named =
        |error: rusqlite::Error| format!("starting a conversation about {doc_path}: {error}");

    let sql = format!(
        "INSERT INTO conversation (doc_path, title, created_at, updated_at)
         VALUES (?1, ?2, {NOW}, {NOW})
         RETURNING {COLUMNS}"
    );
    conn.query_row(&sql, rusqlite::params![doc_path, title], row)
        .map_err(named)
}

pub(crate) fn rename(conn: &Connection, id: i64, title: &str) -> Result<usize, String> {
    if title.trim().is_empty() {
        return Err("a conversation needs a title".to_string());
    }

    let sql = format!("UPDATE conversation SET title = ?1, updated_at = {NOW} WHERE id = ?2");
    conn.execute(&sql, rusqlite::params![title, id])
        .map_err(|error| format!("renaming conversation {id}: {error}"))
}

/// Removing a conversation sweeps its turns, through the cascade the table
/// declares. Nothing in the vault moves: a conversation is entirely inkling's.
pub(crate) fn delete(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM conversation WHERE id = ?1", [id])
}

/// Points a conversation at a live session, or at none.
///
/// Both ids are set together and both may be null, because they only mean
/// anything as a pair: a conversation whose session was evicted keeps the
/// resume id and loses the session id, and the next open sends the first to get
/// the second back.
pub(crate) fn set_session(
    conn: &Connection,
    id: i64,
    session_id: Option<&str>,
    resume_session_id: Option<&str>,
) -> rusqlite::Result<usize> {
    let sql = format!(
        "UPDATE conversation SET session_id = ?1, resume_session_id = ?2, updated_at = {NOW}
         WHERE id = ?3"
    );
    conn.execute(&sql, rusqlite::params![session_id, resume_session_id, id])
}

/// Every turn of one conversation, oldest first, which is reading order.
pub(crate) fn select_turns(conn: &Connection, conversation_id: i64) -> rusqlite::Result<Vec<Turn>> {
    let sql = format!("SELECT {TURN_COLUMNS} FROM turn WHERE conversation_id = ?1 ORDER BY id");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([conversation_id], turn_row)?;
    rows.collect()
}

/// Records a turn as asked, before a byte of it has left the machine.
///
/// Written first rather than on completion, so a turn that never comes back is
/// still a row the next launch can find and mark `interrupted`. That is the only
/// reason the panel can tell "the agent said nothing" from "inkling was closed
/// mid-answer".
pub(crate) fn insert_turn(
    conn: &Connection,
    conversation_id: i64,
    asked: &str,
    snapshot: &str,
) -> Result<Turn, String> {
    if asked.trim().is_empty() {
        return Err("a turn needs a message".to_string());
    }

    // Checked ahead of the insert rather than read off the foreign key's
    // failure, the way `references.rs::insert_suppression` checks its owner: the
    // caller sees this when a conversation was deleted while the composer still
    // held its id, and "FOREIGN KEY constraint failed" is not something they can
    // act on.
    let exists = conn
        .query_row(
            "SELECT 1 FROM conversation WHERE id = ?1",
            [conversation_id],
            |row| row.get::<_, i64>(0),
        )
        .is_ok();
    if !exists {
        return Err(format!(
            "no conversation {conversation_id} to record a turn on"
        ));
    }

    let sql = format!(
        "INSERT INTO turn (conversation_id, asked, state, snapshot, created_at)
         VALUES (?1, ?2, '{PENDING}', ?3, {NOW})
         RETURNING {TURN_COLUMNS}"
    );
    conn.query_row(
        &sql,
        rusqlite::params![conversation_id, asked, snapshot],
        turn_row,
    )
    .map_err(|error| format!("recording a turn on conversation {conversation_id}: {error}"))
}

/// Ends a turn, with the reply when there was one.
///
/// The state is validated here as well as by the table's CHECK, for the reason
/// `references.rs::validate` gives: the constraint makes the rule true of every
/// row ever written, and this makes a broken call say which rule it broke rather
/// than "CHECK constraint failed".
pub(crate) fn finish(
    conn: &Connection,
    id: i64,
    state: &str,
    answered: Option<&str>,
) -> Result<Turn, String> {
    let allowed = final_states();
    if !allowed.contains(&state) {
        return Err(format!(
            "cannot finish turn {id} as {state}: expected one of {}",
            allowed.join(", ")
        ));
    }

    let sql =
        format!("UPDATE turn SET state = ?1, answered = ?2 WHERE id = ?3 RETURNING {TURN_COLUMNS}");
    conn.query_row(&sql, rusqlite::params![state, answered, id], turn_row)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => format!("no turn {id} to finish"),
            other => format!("finishing turn {id}: {other}"),
        })
}

#[tauri::command]
pub fn list_conversations(
    doc_path: String,
    db: State<'_, VaultDb>,
) -> Result<Vec<Conversation>, String> {
    db.with(|conn| select_for(conn, &doc_path))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("listing conversations for {doc_path}: {error}"))
}

#[tauri::command]
pub fn create_conversation(
    doc_path: String,
    title: String,
    db: State<'_, VaultDb>,
) -> Result<Conversation, String> {
    db.with(|conn| insert(conn, &doc_path, &title))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

#[tauri::command]
pub fn rename_conversation(id: i64, title: String, db: State<'_, VaultDb>) -> Result<(), String> {
    db.with(|conn| rename(conn, id, &title))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map(|_| ())
}

#[tauri::command]
pub fn delete_conversation(id: i64, db: State<'_, VaultDb>) -> Result<(), String> {
    db.with(|conn| delete(conn, id))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map(|_| ())
        .map_err(|error| format!("deleting conversation {id}: {error}"))
}

#[tauri::command]
pub fn set_conversation_session(
    id: i64,
    session_id: Option<String>,
    resume_session_id: Option<String>,
    db: State<'_, VaultDb>,
) -> Result<(), String> {
    db.with(|conn| {
        set_session(
            conn,
            id,
            session_id.as_deref(),
            resume_session_id.as_deref(),
        )
    })
    .ok_or_else(|| NO_CONNECTION.to_string())?
    .map(|_| ())
    .map_err(|error| format!("pointing conversation {id} at a session: {error}"))
}

#[tauri::command]
pub fn list_turns(conversation_id: i64, db: State<'_, VaultDb>) -> Result<Vec<Turn>, String> {
    db.with(|conn| select_turns(conn, conversation_id))
        .ok_or_else(|| NO_CONNECTION.to_string())?
        .map_err(|error| format!("listing turns of conversation {conversation_id}: {error}"))
}

#[tauri::command]
pub fn start_turn(
    conversation_id: i64,
    asked: String,
    snapshot: String,
    db: State<'_, VaultDb>,
) -> Result<Turn, String> {
    db.with(|conn| insert_turn(conn, conversation_id, &asked, &snapshot))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

#[tauri::command]
pub fn finish_turn(
    id: i64,
    state: String,
    answered: Option<String>,
    db: State<'_, VaultDb>,
) -> Result<Turn, String> {
    db.with(|conn| finish(conn, id, &state, answered.as_deref()))
        .ok_or_else(|| NO_CONNECTION.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        delete, final_states, finish, insert, insert_turn, rename, select_for, select_turns,
        set_session, Conversation, Turn, STATES,
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

    fn start(db: &VaultDb, doc: &str, title: &str) -> Conversation {
        db.with(|conn| insert(conn, doc, title))
            .expect("a vault should be open")
            .expect("should start a conversation")
    }

    fn ask(db: &VaultDb, conversation_id: i64, asked: &str, snapshot: &str) -> Turn {
        db.with(|conn| insert_turn(conn, conversation_id, asked, snapshot))
            .expect("a vault should be open")
            .expect("should record a turn")
    }

    fn listed(db: &VaultDb, doc: &str) -> Vec<Conversation> {
        db.with(|conn| select_for(conn, doc))
            .expect("a vault should be open")
            .expect("should select")
    }

    fn turns(db: &VaultDb, conversation_id: i64) -> Vec<Turn> {
        db.with(|conn| select_turns(conn, conversation_id))
            .expect("a vault should be open")
            .expect("should select")
    }

    #[test]
    fn should_read_back_a_conversation_it_just_started() {
        let (_vault, db) = open_vault();

        let started = start(&db, "drafts/a.md", "On endings");

        assert_eq!(started.doc_path, "drafts/a.md");
        assert_eq!(started.title, "On endings");
        assert_eq!(started.session_id, None);
        assert_eq!(started.resume_session_id, None);
        assert_eq!(listed(&db, "drafts/a.md").len(), 1);
    }

    /// Unlike a reference, two conversations with the same title are two
    /// conversations: nothing else distinguishes what the writer meant.
    #[test]
    fn should_keep_two_conversations_started_with_the_same_title() {
        let (_vault, db) = open_vault();

        let first = start(&db, "drafts/a.md", "On endings");
        let second = start(&db, "drafts/a.md", "On endings");

        assert_ne!(second.id, first.id);
        assert_eq!(listed(&db, "drafts/a.md").len(), 2);
    }

    #[test]
    fn should_list_only_the_conversations_about_one_document() {
        let (_vault, db) = open_vault();
        start(&db, "drafts/a.md", "On endings");
        start(&db, "drafts/b.md", "On openings");

        let listed = listed(&db, "drafts/a.md");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "On endings");
    }

    #[test]
    fn should_refuse_a_conversation_with_no_title() {
        let (_vault, db) = open_vault();

        let result = db
            .with(|conn| insert(conn, "drafts/a.md", "   "))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("needs a title")));
    }

    #[test]
    fn should_refuse_to_rename_a_conversation_to_nothing() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");

        let result = db
            .with(|conn| rename(conn, started.id, ""))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("needs a title")));
        assert_eq!(listed(&db, "drafts/a.md")[0].title, "On endings");
    }

    #[test]
    fn should_rename_a_conversation() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");

        db.with(|conn| rename(conn, started.id, "On last lines"))
            .expect("a vault should be open")
            .expect("should rename");

        assert_eq!(listed(&db, "drafts/a.md")[0].title, "On last lines");
    }

    #[test]
    fn should_point_a_conversation_at_a_session_and_then_at_none() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");

        db.with(|conn| set_session(conn, started.id, Some("s-1"), None))
            .expect("a vault should be open")
            .expect("should set");
        let live = listed(&db, "drafts/a.md");
        db.with(|conn| set_session(conn, started.id, None, Some("s-1")))
            .expect("a vault should be open")
            .expect("should clear");
        let evicted = listed(&db, "drafts/a.md");

        assert_eq!(live[0].session_id.as_deref(), Some("s-1"));
        assert_eq!(evicted[0].session_id, None);
        assert_eq!(evicted[0].resume_session_id.as_deref(), Some("s-1"));
    }

    #[test]
    fn should_record_a_turn_as_pending_with_the_snapshot_it_was_asked_against() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");

        let turn = ask(&db, started.id, "Tighten this", "# Draft\n\nThe body.");

        assert_eq!(turn.state, "pending");
        assert_eq!(turn.answered, None);
        assert_eq!(turn.snapshot, "# Draft\n\nThe body.");
    }

    #[test]
    fn should_refuse_a_turn_with_no_message() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");

        let result = db
            .with(|conn| insert_turn(conn, started.id, "  ", ""))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("needs a message")));
    }

    #[test]
    fn should_refuse_a_turn_on_a_conversation_that_is_not_there() {
        let (_vault, db) = open_vault();

        let result = db
            .with(|conn| insert_turn(conn, 404, "Tighten this", ""))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("no conversation 404")));
    }

    #[test]
    fn should_finish_a_turn_with_the_reply() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");
        let turn = ask(&db, started.id, "Tighten this", "");

        let finished = db
            .with(|conn| finish(conn, turn.id, "answered", Some("Here you are.")))
            .expect("a vault should be open")
            .expect("should finish");

        assert_eq!(finished.state, "answered");
        assert_eq!(finished.answered.as_deref(), Some("Here you are."));
    }

    /// The panel renders a turn's state, so a state the CHECK would refuse has
    /// to come back naming itself rather than as "constraint failed".
    #[test]
    fn should_refuse_to_finish_a_turn_in_a_state_it_does_not_know() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");
        let turn = ask(&db, started.id, "Tighten this", "");

        let result = db
            .with(|conn| finish(conn, turn.id, "thinking", None))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("thinking")));
        assert_eq!(turns(&db, started.id)[0].state, "pending");
    }

    /// `pending` is [`insert_turn`]'s alone. Moving a finished turn back to it
    /// would leave the panel waiting on a stream nobody is going to open.
    #[test]
    fn should_refuse_to_move_a_turn_back_to_pending() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");
        let turn = ask(&db, started.id, "Tighten this", "");

        let result = db
            .with(|conn| finish(conn, turn.id, "pending", None))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("pending")));
    }

    #[test]
    fn should_refuse_to_finish_a_turn_that_is_not_there() {
        let (_vault, db) = open_vault();

        let result = db
            .with(|conn| finish(conn, 404, "answered", None))
            .expect("a vault should be open");

        assert!(result.is_err_and(|error| error.contains("no turn 404")));
    }

    #[test]
    fn should_list_turns_in_the_order_they_were_asked() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");
        ask(&db, started.id, "First", "");
        ask(&db, started.id, "Second", "");

        let asked: Vec<String> = turns(&db, started.id)
            .into_iter()
            .map(|turn| turn.asked)
            .collect();

        assert_eq!(asked, vec!["First".to_string(), "Second".to_string()]);
    }

    /// The cascade the table declares: deleting a conversation must not leave
    /// turns pointing at an id that no longer exists.
    #[test]
    fn should_sweep_the_turns_when_their_conversation_is_deleted() {
        let (_vault, db) = open_vault();
        let started = start(&db, "drafts/a.md", "On endings");
        ask(&db, started.id, "Tighten this", "");

        db.with(|conn| delete(conn, started.id))
            .expect("a vault should be open")
            .expect("should delete");

        assert_eq!(turns(&db, started.id).len(), 0);
        assert_eq!(listed(&db, "drafts/a.md").len(), 0);
    }

    #[test]
    fn should_record_timestamps_in_the_projects_format() {
        let (_vault, db) = open_vault();

        let started = start(&db, "drafts/a.md", "On endings");

        // ISO 8601 UTC, the same `strftime` form `0001_meta.sql` uses.
        assert_eq!(started.created_at.len(), 24, "got {:?}", started.created_at);
        assert!(
            started.updated_at.ends_with('Z'),
            "got {:?}",
            started.updated_at
        );
    }

    /// The four the table's CHECK admits, spelled out once here so a fifth added
    /// to the migration without a home in the code is a red test rather than a
    /// state nothing can ever write. The three below are derived from them, so
    /// this pins both.
    #[test]
    fn states_are_the_four_the_table_admits_and_three_of_them_end_a_turn() {
        assert_eq!(STATES, ["pending", "answered", "failed", "interrupted"]);
        assert_eq!(final_states(), vec!["answered", "failed", "interrupted"]);
    }

    /// `src/lib/bridge.ts` mirrors these shapes by hand. If serde stops
    /// producing them, the frontend reads `undefined` and nothing else in either
    /// suite notices.
    #[test]
    fn serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&Conversation {
            id: 7,
            doc_path: "drafts/a.md".to_string(),
            title: "On endings".to_string(),
            session_id: Some("s-1".to_string()),
            resume_session_id: None,
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-02T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r#"{"id":7,"docPath":"drafts/a.md","title":"On endings","sessionId":"s-1","resumeSessionId":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-02T00:00:00.000Z"}"#
        );
    }

    #[test]
    fn a_turn_serialises_to_the_shape_the_frontend_reads() {
        let json = serde_json::to_string(&Turn {
            id: 3,
            conversation_id: 7,
            asked: "Tighten this".to_string(),
            answered: None,
            state: "pending".to_string(),
            snapshot: "# Draft".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        })
        .expect("should serialise");

        assert_eq!(
            json,
            r##"{"id":3,"conversationId":7,"asked":"Tighten this","answered":null,"state":"pending","snapshot":"# Draft","createdAt":"2026-01-01T00:00:00.000Z"}"##
        );
    }
}

-- Conversations: what the writer and the agent said about one document.
--
-- A document holds several conversations, and a conversation holds one turn per
-- round trip. Both survive the app closing, which is the whole point: a held
-- session on toryo's dispatch daemon dies with the daemon, and the prose said
-- either side of it is the part that must not.
--
-- `session_id` is the daemon's live session, and it is deliberately nullable. A
-- conversation with none has not spoken yet, or spoke to a session that has
-- since been evicted, crashed or closed; the next turn opens a new one.
-- `resume_session_id` is what a re-open passes so the new session inherits the
-- old one's history rather than starting cold.
--
-- `doc_path` is a subject column in `paths.rs`: the conversation belongs to that
-- document, the way a voice dismissal does, so a rename carries it and a
-- rename onto an occupied path clears what was there.
--
-- No `IF NOT EXISTS`, for the reason `0001_meta.sql` gives.

CREATE TABLE conversation (
  id                INTEGER PRIMARY KEY,
  doc_path          TEXT NOT NULL,
  title             TEXT NOT NULL,
  session_id        TEXT,
  resume_session_id TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;

CREATE INDEX conversation_doc ON conversation (doc_path);

-- One round trip. `asked` is the writer's message and `answered` is the reply,
-- null until there is one.
--
-- `snapshot` is the document as it stood before the turn, stored even though
-- nothing reads it yet: it is the one thing here that cannot be reconstructed
-- afterwards, since the writer keeps typing while the agent answers, and 4b's
-- accept-or-reject needs to know what the agent was looking at.
--
-- The four states are the whole lifecycle. A turn is `pending` from the moment
-- it is asked; it ends `answered` or `failed`; and it ends `interrupted` when
-- inkling was closed while it was still in flight, because a held session's
-- event stream has no backlog and a reply that landed meanwhile cannot be
-- recovered from it. Inventing an answer there would be the worse failure.

CREATE TABLE turn (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  asked           TEXT NOT NULL,
  answered        TEXT,
  state           TEXT NOT NULL,
  snapshot        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  CHECK (state IN ('pending', 'answered', 'failed', 'interrupted'))
) STRICT;

CREATE INDEX turn_conversation ON turn (conversation_id);

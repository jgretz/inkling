-- Revisions: the document as it stood at a moment the writer chose to keep.
--
-- Written only when asked for. Nothing here is taken on a save, on a close, on
-- a timer or on an agent turn: `turn.snapshot` in `0004_conversation.sql`
-- already holds one document per turn, and it answers a different question.
-- This one answers "what did this read like before I restructured it".
--
-- `source` is the whole document, the frontmatter block as well as the body,
-- because putting it back is what a revision is for.
--
-- `doc_path` is a subject column in `paths.rs`: a revision belongs to that
-- document, the way a conversation does, so a rename carries it and a rename
-- onto an occupied path clears what was there.
--
-- No unique index over `(doc_path, source)`. Two snapshots of identical text
-- taken at different moments are two revisions: the second click says the text
-- in hand is still worth keeping, and collapsing it into the first would make
-- the button do nothing with nothing said about it.
--
-- No `IF NOT EXISTS`, for the reason `0001_meta.sql` gives.

CREATE TABLE revision (
  id         INTEGER PRIMARY KEY,
  doc_path   TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX revision_doc ON revision (doc_path);

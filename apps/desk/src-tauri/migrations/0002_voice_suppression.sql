-- Voice findings the writer dismissed, one row per dismissal.
--
-- Keyed by the finding's anchor rather than by a pair of offsets: a quote plus
-- the characters either side of it is what survives the paragraph around it
-- being rewritten, which is the whole point of remembering a dismissal.
--
-- `hint` is stored but deliberately left out of the unique index. It is the
-- offset the anchor was made at, only ever a tie-breaker when two occurrences
-- score equally, so including it would let one dismissal be stored twice at two
-- positions in the same document.
--
-- No `IF NOT EXISTS`, for the reason `0001_meta.sql` gives.

CREATE TABLE voice_suppression (
  id         INTEGER PRIMARY KEY,
  doc_path   TEXT NOT NULL,
  rule_id    TEXT NOT NULL,
  quote      TEXT NOT NULL,
  prefix     TEXT NOT NULL,
  suffix     TEXT NOT NULL,
  hint       INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- One dismissal per rule per anchored passage.
CREATE UNIQUE INDEX voice_suppression_anchor
  ON voice_suppression (doc_path, rule_id, quote, prefix, suffix);

-- Every read is "what did this writer dismiss in the document they have open".
CREATE INDEX voice_suppression_doc ON voice_suppression (doc_path);

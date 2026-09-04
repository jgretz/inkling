-- The first migration. One table for provenance, and deliberately nothing
-- else: tables for conversations, references and voice suppressions belong to
-- the roadmap items that use them, so each arrives with its own migration
-- rather than inheriting a guessed schema from here.
--
-- No `IF NOT EXISTS`, on purpose. The runner's `user_version` gate is the only
-- thing that stops a migration running twice; if that gate ever breaks, this
-- must fail loudly rather than pass quietly.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- Generated in SQL because a migration has no application code around it. The
-- format is the ISO 8601 UTC string the rest of the project uses.
INSERT INTO meta (key, value)
VALUES ('created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

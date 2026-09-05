-- References: the other things a document or a group carries into a turn.
--
-- One table with two mutually exclusive owner columns rather than one
-- `owner_path`. `paths.rs` keys its rewrites on `(table, column)` with no
-- predicate, so every column it rewrites has to hold exactly one kind of path:
-- a column that held a document path on some rows and a group path on others
-- could not be rewritten correctly by either registry. `doc_path` and
-- `group_path` therefore each mean one thing, and a CHECK keeps exactly one of
-- them set.
--
-- `target_path` is always a vault-relative markdown path and `url` is always a
-- web link, which is why they are two columns and not one. The remaining CHECKs
-- tie each to the kind that may carry it.
--
-- No `IF NOT EXISTS`, for the reason `0001_meta.sql` gives.

CREATE TABLE reference (
  id          INTEGER PRIMARY KEY,
  doc_path    TEXT,
  group_path  TEXT,
  kind        TEXT NOT NULL,
  target_path TEXT,
  url         TEXT,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  CHECK (kind IN ('doc', 'link', 'note')),
  CHECK ((doc_path IS NULL) <> (group_path IS NULL)),
  CHECK ((kind = 'link') = (url IS NOT NULL)),
  CHECK ((kind IN ('doc', 'note')) = (target_path IS NOT NULL))
) STRICT;

-- One row per (owner, kind, target). `COALESCE` because the unset owner column
-- and the unset target column are NULL, and NULLs are all distinct to a unique
-- index, which would let the same reference be attached twice.
CREATE UNIQUE INDEX reference_one ON reference (
  COALESCE(doc_path, ''),
  COALESCE(group_path, ''),
  kind,
  COALESCE(target_path, url)
);

CREATE INDEX reference_doc ON reference (doc_path);
CREATE INDEX reference_group ON reference (group_path);

-- A document turning off one reference it inherits from a group above it.
--
-- Keyed on the reference's row id rather than on its target, the way a voice
-- dismissal is keyed on the finding's anchor rather than on its offsets: the id
-- is what survives the group's reference being retitled or repointed. The
-- cascade is what sweeps these when the group's reference itself goes, so
-- nothing is left pointing at a row that no longer exists.
--
-- Only ever a *group's* reference: a document's own reference is detached by
-- deleting it, so a row here whose reference is owned by the same document
-- would be a second way to say the same thing.

CREATE TABLE reference_suppression (
  id           INTEGER PRIMARY KEY,
  doc_path     TEXT NOT NULL,
  reference_id INTEGER NOT NULL REFERENCES reference (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX reference_suppression_one
  ON reference_suppression (doc_path, reference_id);

CREATE INDEX reference_suppression_doc ON reference_suppression (doc_path);

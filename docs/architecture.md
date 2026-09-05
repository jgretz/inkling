# Architecture

## Repository layout

```
apps/desk/            the Tauri desktop app
  src/                React frontend
    lib/              state, settings, the Rust boundary, the agent boundary
    components/       one directory per panel
      library/        the document tree: groups, filter, create, rename, move
      findings/       the voice findings strip, under the editor
  src-tauri/          the Rust half
    src/vault.rs      filesystem commands, path containment
    src/settings.rs   one JSON file in the platform config dir
    src/data.rs       the vault's SQLite database, one connection
    src/voice.rs      dismissed findings, stored against their anchors
    src/references.rs what a document or a group carries into a turn
    src/paths.rs      the columns a rename has to rewrite
    src/migrations.rs the schema history, as data
    migrations/       one .sql file per migration
packages/vault/       markdown parsing and document summaries, pure
packages/voice/       the sixteen voice detectors and `check`, pure
  src/rules.ts        rule sets: parsed, validated, cascaded
  src/suppress.ts     matching dismissals to findings through an edit
examples/vault/       a small vault to develop against
scripts/              repo tooling
```

`packages/*` holds logic that needs no filesystem and no window. `apps/*` holds
everything that touches the outside world.

## The three panels

One document, three views of it, left to right.

| Panel   | What it shows                                          | Where it lives       |
| ------- | ------------------------------------------------------ | -------------------- |
| Preview | The document rendered, tracking the editor buffer live | `components/preview` |
| Editor  | Raw markdown in CodeMirror 6                           | `components/editor`  |
| Agent   | An open conversation about the document                | `components/chat`    |

A collapsible library sits left of the preview, showing the vault as the
writer's own folders arrange it: documents at the root first, in an unnamed
section, then a group per directory, nested as deep as they go. Each panel
toggles from the title bar and each boundary is a draggable splitter; the widths
persist across restarts.

## State

`useWorkspace` owns the vault, the document list and the open buffer. It is a
thin effect layer over `workspaceReducer`, which is pure.

Two rules the reducer exists to enforce:

- **Dirtiness is derived, not flagged.** An open document holds both the draft
  and the last text known to be on disk. They differ or they do not.
- **Every async result carries the path it belongs to.** A save that lands after
  the writer switched documents is discarded rather than written into the new
  buffer.

Autosave fires 800ms after the last keystroke. Command-S writes immediately.

## The vault

A vault is a directory. `list_docs` walks it and returns every markdown file
with its contents, because a personal vault is a few hundred kilobytes of prose
and holding it all in memory is what lets the library search and the agent's
context picker work without a read per file.

That is also what makes a voice rule set free to read. `lib/voice-cascade.ts`
walks a document's ancestor directories, looks each `voice.md` up in the loaded
sources and parses its frontmatter; no level of the cascade is a file read. The
live draft wins over the scan wherever the two describe the same file, both for
the document's own `voice:` key and for a `voice.md` the writer has open, so
turning a rule off takes effect as it is typed rather than at the next scan.

Groups are directories. `list_groups` returns every directory in the vault
alongside the documents, because a group a writer has just made and put nothing
in yet holds no markdown and a listing of files cannot see it. Nothing else
records a group: no table, no id, no membership, which is what `docs/model.md`
means by a hierarchy that needs no storage of its own. `packages/vault/src/groups.ts`
derives the tree, the filter and every path rewrite from the paths alone.

Path safety is two functions, one per kind of path. `resolve` in
`src-tauri/src/vault.rs` rejects `..`, absolute components and non-markdown
extensions before touching the disk, so a hostile path fails identically whether
or not its target exists. `resolve_dir` beside it applies the same containment
rule to a directory, drops the extension check, and adds two refusals of its
own: the vault root is not a group, and neither is a segment the listing hides,
so a writer cannot make a `.drafts` the library could never show them.

## The vault's data directory

Everything inkling knows about a vault that is not the writer's prose lives in
`.inkling/inkling.db` inside the vault, beside the files it describes. Deleting
that folder is the whole recovery story, which is why nothing irreplaceable may
ever go in it and why `.inkling/.gitignore` keeps it out of the writer's own
repository.

`list_docs` already skips any dotted directory, so the data directory cannot
reach the document list.

One connection exists at a time, held in Tauri managed state. Opening a vault
closes the previous connection and installs the new one under a single lock, so
switching vaults is atomic: there is no window in which a query could reach the
old vault's rows. That is also why there is no `close_vault_db` command for the
frontend to race the open with.

A database that will not open is a status, not an error. The vault still lists
and edits; the writer gets a line in the status bar naming the failure and the
recovery.

Dismissed voice findings are the first rows to join `meta` in there, one per
dismissal, keyed by the document's path plus the rule and the anchor's quote,
prefix and suffix. The anchor's `hint` is stored but stays out of the unique
index: it is a tie-breaker for two equal candidates, not identity, and indexing
it would let one dismissal be stored twice at two positions.

Rows are kept until the writer restores one. There is no sweep for anchors that
no longer resolve, because anything keyed on "this document is gone" would
delete dismissals the first time a writer renamed a folder in Finder.

References join them: one row per attachment, owned by a document or by a group
and never both, carrying either a vault-relative `target_path` or a `url`. A
group's references cascade onto every document inside it, and a document turns
one off with a row in `reference_suppression` rather than by deleting something
other documents are reading. That table is keyed on the reference's row id, so a
retitled or repointed group reference stays off, and the foreign key cascade
sweeps the suppressions when the reference itself goes. A note's markdown body
is an ordinary vault document under `references/`, not a blob in here: detaching
the row leaves the writer's prose exactly where it was.

Which of those references reach a given document is decided nowhere near SQL.
`list_references` hands the whole table over in one call, and
`lib/references.ts` walks the document's ancestor groups against the sources the
vault scan already loaded, root-most group first and the document's own last.
A reference naming a file the vault no longer holds is kept and shown as broken,
for the same reason a dismissal survives a folder rename in Finder.

A rename inside inkling does follow. `src-tauri/src/paths.rs` holds two
registries of stored columns and the two rewrites over them. `PATH_KEYED` lists
the columns holding a **document** path and `GROUP_KEYED` the columns holding a
**group** path, because a rewrite acts on a column and a column has to mean one
thing. A group rename takes the prefix form over the document columns, and both
the exact and the prefix form over the group ones: the reference attached to
`drafts` stores the bare string `drafts`, which no comparison against `drafts/`
would ever match. A single-document rename takes `PATH_KEYED` only, since moving
a document changes no group. The matching is `substr`, never `LIKE`, because a
group a writer named `50%_done` would make a `LIKE` pattern match paths that
have nothing to do with it.

Every entry also carries a role, which is a separate question from which kind of
path it holds. A **subject** column says whose row it is, so a row already at the
destination is an orphan of something that has gone and is deleted. A
**pointer** column says what the row points at, and `reference.target_path` is
the only one so far. A row sitting there is a live attachment shown as broken,
and the rename putting a file back at that path is the moment it becomes whole
again, so nothing is swept ahead of it.

The order the two halves happen in is the whole design. A transaction opens, the
rows are rewritten, `fs::rename` runs, and the commit comes last. The half that
can be abandoned for nothing straddles the half that cannot, so a failed rename
drops the transaction on the way out and leaves both halves exactly as they
were. The one residual case, a commit that fails after the directory has moved,
renames the directory back and reports both failures; if that reverse rename
also fails, the error says plainly that the folder moved and the dismissals
under it did not. With no database open the directory rename happens alone,
which is the same degradation the status bar already explains.

Rows already sitting at the target of a subject column are deleted first, inside
the same transaction. The target does not exist on disk at that point, so they
are orphans of a group or a document that has gone, and leaving them would fail
the rename on a unique index with a constraint error the writer cannot act on.
A rename deletes those, and the one row it merges away when it points two of a
document's references at the same file, and nothing else. The suppressions the
reference cascade takes with a detached reference are the only rows anything
outside a rename deletes.

Adding a migration is three things: a new `src-tauri/migrations/NNNN_name.sql`,
one appended entry in `MIGRATIONS`, and the line in the catalog test that pins
the whole history. A migration that has shipped is never edited, because vaults
in the wild have already run it. The applied version is SQLite's own
`PRAGMA user_version`, set in the same transaction as the statements it records.

## The agent boundary

`lib/agent.ts` defines the contract and nothing else. A transport takes a turn
and yields reply chunks; the panel handles streaming, cancellation and errors
around it. The shipped transport is a stub that reports what it was handed.

The context strip above the composer lists every piece of text the next turn
will carry, with its token estimate: the open document, the selection, and the
assembled reference cascade, each inherited entry naming the group it came from.
That is the app's honesty surface, and nothing should ever reach a model that is
not named there. It is also the only place a reference is attached or detached
in this build, which is why the picker lives beside the chips rather than in the
library.

See [`agent.md`](./agent.md) for what is still undecided.

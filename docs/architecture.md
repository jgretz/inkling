# Architecture

## Repository layout

```
apps/desk/            the Tauri desktop app
  src/                React frontend
    lib/              state, settings, the Rust boundary, the agent boundary
    components/       one directory per panel
      findings/       the voice findings strip, under the editor
  src-tauri/          the Rust half
    src/vault.rs      filesystem commands, path containment
    src/settings.rs   one JSON file in the platform config dir
    src/data.rs       the vault's SQLite database, one connection
    src/voice.rs      dismissed findings, stored against their anchors
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

A collapsible library sits left of the preview, listing every markdown file in
the vault. Each panel toggles from the title bar and each boundary is a
draggable splitter; the widths persist across restarts.

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

Path safety is one function. `resolve` in `src-tauri/src/vault.rs` rejects
`..`, absolute components and non-markdown extensions before touching the disk,
so a hostile path fails identically whether or not its target exists.

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
delete dismissals the first time a writer renamed a folder in Finder. Following
a rename belongs with the rest of the path bookkeeping in roadmap 2.2.

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
will carry, with its token estimate. That is the app's honesty surface, and
nothing should ever reach a model that is not named there.

See [`agent.md`](./agent.md) for what is still undecided.

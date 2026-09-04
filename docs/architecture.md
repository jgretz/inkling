# Architecture

## Repository layout

```
apps/desk/            the Tauri desktop app
  src/                React frontend
    lib/              state, settings, the Rust boundary, the agent boundary
    components/       one directory per panel
  src-tauri/          the Rust half
    src/vault.rs      filesystem commands, path containment
    src/settings.rs   one JSON file in the platform config dir
packages/vault/       markdown parsing and document summaries, pure
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

Path safety is one function. `resolve` in `src-tauri/src/vault.rs` rejects
`..`, absolute components and non-markdown extensions before touching the disk,
so a hostile path fails identically whether or not its target exists.

## The agent boundary

`lib/agent.ts` defines the contract and nothing else. A transport takes a turn
and yields reply chunks; the panel handles streaming, cancellation and errors
around it. The shipped transport is a stub that reports what it was handed.

The context strip above the composer lists every piece of text the next turn
will carry, with its token estimate. That is the app's honesty surface, and
nothing should ever reach a model that is not named there.

See [`agent.md`](./agent.md) for what is still undecided.

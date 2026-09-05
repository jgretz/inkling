# inkling

A macOS desktop app for writing articles, essays and talks in markdown, with an
agent in the room.

Bun monorepo: `apps/*` + `packages/*` workspaces, `@inkling/*` package scope.
Tauri 2 + React 19 + Vite 7 + Tailwind 4.

## The shape of the app

Three panels over one document, left to right: the rendered markdown, the raw
markdown editor, and an open conversation with an agent that can see both. A
collapsible library sits left of the preview.

- [`docs/model.md`](./docs/model.md) is what inkling is built around.
- [`docs/roadmap.md`](./docs/roadmap.md) is the order it gets built in.
- [`docs/turn-taking.md`](./docs/turn-taking.md) is who may write when.
- [`docs/architecture.md`](./docs/architecture.md) is how the code is laid out.

## Rules

1. **Files are the source of truth.** A vault is the writer's own directory of
   markdown, outside this repository, which inkling reads and writes in place.
   Never assume git is involved at that end. Everything inkling stores that is
   not the writer's prose lives under `.inkling/` in the vault and must be
   regenerable or discardable.
2. **The writer always knows what the agent can see.** Every byte in a turn's
   context is named in the context strip before it is sent. No hidden retrieval.
3. **Pure logic in `packages/*`, effects in `apps/*`.** The reducer, the parser
   and the summariser are testable without a filesystem or a window; keep them
   that way. See [`docs/testing.md`](./docs/testing.md).
4. Path handling on the Rust side rejects traversal before touching the disk.
   `resolve` and `resolve_dir` in `apps/desk/src-tauri/src/vault.rs`, one for a
   document and one for a group, are the only two places a vault-relative path
   becomes an absolute one.

## Commands

| What                        | Command                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Run the desktop app         | `bun run dev`                                                                            |
| Frontend only, in a browser | `bun run web`                                                                            |
| Typecheck every workspace   | `bun run typecheck`                                                                      |
| Tests                       | `bun run test` (Rust: `cargo test --manifest-path apps/desk/src-tauri/Cargo.toml`)       |
| Format                      | `bun run format`                                                                         |
| Bundle a `.app`             | `bun run build`                                                                          |
| Regenerate the icon         | `bun scripts/make-icon.ts && cd apps/desk && bunx tauri icon src-tauri/icons/source.png` |

`examples/vault/` is a small vault to point the app at while developing.

## Where things are

- `apps/desk/src/lib/` owns state and the Rust boundary. `bridge.ts` is the only
  file that names a Tauri command.
- `apps/desk/src/components/` is one directory per panel.
- `packages/vault/` parses frontmatter and derives document summaries.
- Global engineering rules live in `~/.claude/rules/`; this file does not repeat
  them.

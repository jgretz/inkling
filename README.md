# inkling

A macOS writing desk. Markdown on the left as a reader sees it, markdown in the
middle as you write it, and an agent on the right that can see both.

## Requirements

Bun, a Rust toolchain, and Xcode command line tools.

## Getting started

```
bun install
bun run dev
```

The app opens with no vault. Point it at a folder of markdown files, or at
`examples/vault/` in this repo to see it with something in it.

## Layout

- `apps/desk` — the Tauri app
- `packages/vault` — markdown parsing and document summaries
- `docs/` — architecture, testing, and the open questions about the agent

See [`CLAUDE.md`](./CLAUDE.md) for the command table and the project's rules.

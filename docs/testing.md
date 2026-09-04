# Testing

`bun run test` from the repo root runs every TypeScript suite. Rust tests run
under `cargo test --manifest-path apps/desk/src-tauri/Cargo.toml`.

Use the script, not a bare `bun test`: the script preloads
`scripts/dom-setup.ts`, which registers happy-dom's globals, and component
tests have no `document` without it.

## What must have a test

- Anything in `packages/*`. Shared code, so a regression propagates.
- The workspace reducer. Its whole reason to be pure is that the rules about
  dirtiness and stale async results are checkable without a filesystem.
- Parsing and transforms: frontmatter, word counts, settings, relative time.
- Path containment in `src-tauri/src/vault.rs`.
- The migration registry in `src-tauri/src/migrations.rs`. The catalog test
  spells out every shipped migration, so appending one is a deliberate edit
  rather than a silent change to what a vault's database contains.

## What does not

- Panel layout. A component with no branching is JSX, and a test over it pins
  markup rather than behavior.
- Tauri wiring, Vite config, the icon script.

## Conventions

Tests live in a `tests/` directory beside `src/`, mirroring its structure. Name
cases `should <behavior> when <condition>`. Arrange, act and assert are
separated by a blank line each.

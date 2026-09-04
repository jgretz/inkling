# Testing

`bun test` from the repo root runs every TypeScript suite. Rust tests run under
`cargo test --manifest-path apps/desk/src-tauri/Cargo.toml`.

## What must have a test

- Anything in `packages/*`. Shared code, so a regression propagates.
- The workspace reducer. Its whole reason to be pure is that the rules about
  dirtiness and stale async results are checkable without a filesystem.
- Parsing and transforms: frontmatter, word counts, settings, relative time.
- Path containment in `src-tauri/src/vault.rs`.

## What does not

- Panel layout. A component with no branching is JSX, and a test over it pins
  markup rather than behavior.
- Tauri wiring, Vite config, the icon script.

## Conventions

Tests live in a `tests/` directory beside `src/`, mirroring its structure. Name
cases `should <behavior> when <condition>`. Arrange, act and assert are
separated by a blank line each.

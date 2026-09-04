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

## Render tests need a DOM, per file

`bun test` has no DOM. A render suite gets one by calling `autoCleanup()` from
`apps/desk/tests/setup.ts` at its top level, as its first import.

Two rules that are not obvious and cost an afternoon each:

- **Register per file and hand the globals back.** Registering happy-dom
  replaces the globals wholesale, `fetch` among them, and every test file in a
  run shares one process. A suite that leaves it registered breaks the next
  suite that speaks HTTP for real, with an error naming a file that has nothing
  to do with a DOM.
- **Query off what `render()` returns, never off `screen`.** The global `screen`
  binds `document.body` when the testing library is evaluated, which happens
  before any registration, so it is bound to a document that no longer exists.

## Conventions

Tests live in a `tests/` directory beside `src/`, mirroring its structure. Name
cases `should <behavior> when <condition>`. Arrange, act and assert are
separated by a blank line each.

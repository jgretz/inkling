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

## What the suite does not catch

Five bugs reached a running app past a green suite, four clean typechecks and a
clean format check. Every one was in a class no test here can see:

- **Permissions, which fail silently.** A capability that is not granted refuses
  the call and says nothing. See `apps/desk/tests/capabilities.test.ts`.
- **WebKit-only runtime behaviour.** See the section below.
- **Layout under real content.** A pasted URL is one unbreakable token; it grew a
  panel and dragged the whole window sideways.
- **Effect ordering.** A restore effect that re-ran and undid its own first pass.
- **Derivations that never re-run.** Everything shown about a document came only
  from a full vault scan.

Two of them were visible in one screenshot. Run the app and look at it, and
treat a screenshot as a debugging input rather than a courtesy.

## Running the suite

`bun test` from the repo root. `bunfig.toml` preloads `scripts/dom-setup.ts` so
a bare run has a DOM, and the root `test` script passes the same file so both
commands behave identically. A run started inside a workspace directory does not
see `bunfig.toml`, because bun resolves it from the cwd without walking up, so
scope a run with a path argument rather than by changing directory.

## Render tests need a DOM, per file

`bun test` has no DOM. A render suite gets one by calling `autoCleanup()` from
`apps/desk/tests/setup.ts` at its top level, as its first import.

Two rules that are not obvious and cost an afternoon each:

- **Register per file and hand the globals back.** Registering happy-dom
  replaces the globals wholesale, `fetch` among them, and every test file in a
  run shares one process. A suite that leaves it registered breaks the next
  suite that speaks HTTP for real, with an error naming a file that has nothing
  to do with a DOM.
- **Anything a library reads at import time predates the DOM.** Static imports
  run before `autoCleanup()`'s `beforeAll`, so a library that captures
  `navigator` on load captures Bun's, not happy-dom's. Bun reports `MacIntel` on
  a Mac and happy-dom reports `X11; Darwin arm64`, which is why CodeMirror
  resolves `Mod` to Cmd in tests while happy-dom would suggest Ctrl. Read the
  same value at the test file's module scope rather than assuming either.
- **Query off what `render()` returns, never off `screen`.** The global `screen`
  binds `document.body` when the testing library is evaluated, which happens
  before any registration, so it is bound to a document that no longer exists.

## The webview is WebKit, and the suite is not

bun and happy-dom are permissive where the Tauri webview is strict, so a whole
class of bug passes every test here and fails on the first real use.

The one that has already bitten: `fetch` pulled off the global and called
without a receiver, or called as a property of an ordinary object, throws
`Can only call Window.fetch on instances of Window` in WebKit and nowhere else.
`boundFetch` in `packages/toryo/src/sse.ts` is the fix and
`tests/bound-fetch.test.ts` reproduces the rule as a stub that refuses a wrong
receiver, because no runtime the suite can run in will refuse it for us.

When a browser API is handed around as a value rather than called in place, ask
whether it needs its receiver, and write the rule down as a stub if it does.

## Conventions

Tests live in a `tests/` directory beside `src/`, mirroring its structure. Name
cases `should <behavior> when <condition>`. Arrange, act and assert are
separated by a blank line each.

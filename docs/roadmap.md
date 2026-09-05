# Roadmap

The order of work, decomposed by writer-facing outcome rather than by layer.
Each item is one toryo code-task. [`model.md`](./model.md) is the decided model
these build toward.

## Sequencing

Phases one through three depend on nothing outside this repo and can proceed
while the toryo dispatch work lands. Phase four waits on toryo. Phases five and
six follow it.

| toryo run                              | Gives inkling                   | Blocks                         |
| -------------------------------------- | ------------------------------- | ------------------------------ |
| `b7c44602` HTTP write plane            | The transport                   | `82bcbabe`                     |
| `82bcbabe` browser-safe client subpath | What inkling's own copy follows | Phase 4                        |
| `b18e6297` resumable sessions          | Warm turns                      | Phase 4 quality, not its start |
| `20b2dd3f` held-open sessions          | Conversational latency          | Nothing; upside only           |

Phase four can start on `82bcbabe` alone. Resume makes it good rather than
possible.

## In flight

Nothing.

Phases 1 and 2 are complete and merged, and so are 3 (`370adfa9`), 4a
(`69034d50`) and 4b (`3d1ae893`): the turn is derived from focus with a pin over
it, and both edit paths are built. 4c (`a02a1681`) is done and awaiting merge:
both sides point at passages by quote anchor, and the editor reveals and tints
what they name. Phase 4 is complete.

Phase 4 is split three ways rather than by its numbered items. 4a carries 4.1,
4.2 and 4.5, because prompt assembly is where voice guidance lands and building
it twice would be wasteful. 4b is 4.3 and 4c is 4.4. Everything is serialized:
all three touch the chat panel and `App.tsx`, so parallel runs would collide.

The toryo dependency is met. All four dispatch runs landed, and they delivered
more than the roadmap assumed: `@toryo/dispatch-client/http` carries a
**held-session** plane, not only resumable jobs. A session is a live process the
app pushes messages into, so 4a is built on `openSession` and `postMessage`
rather than one job per turn. Eviction is the lifecycle rather than an error: a
410 carries a `resumeSessionId`, and re-opening with it is a resume.

What 4a could not do is depend on that package. Nothing in toryo's `packages/` is
published and every one of them is private with `workspace:*` dependencies, so
`packages/toryo/` is a vendored, dependency-free copy of the held-session half
instead. Publishing a browser-safe subset would collapse it into a dependency,
and that is toryo's task rather than inkling's.

## Shared files

These are touched by nearly every task and are where parallel work collides.
Serialize anything that edits them, or plan for rebase conflicts.

- `apps/desk/src/App.tsx`
- `apps/desk/src/lib/settings.ts`
- `apps/desk/src/lib/workspace-state.ts`
- `packages/vault/src/index.ts`

---

## Phase 1: Voice checks

The highest-value work that depends on nothing. It gives the app a fast feedback
loop that no amount of model latency can spoil, and it is the one feature that
is useful on day one with no agent at all.

**1.1 The detectors.** A new `packages/voice`, pure functions over text, no
window and no network. Regular-expression detectors for em dashes, curly quotes,
negative parallelism, Title Case headings, banned words and banned opening
formulas. Statistical detectors for triplets, transition stacking and
sentence-length uniformity. Each finding carries a quote anchor, a rule id, and a
one-line explanation. Done when the package has tests covering every detector
including its false-positive edges, and no dependency on React or Tauri.

**1.2 Findings in the editor.** CodeMirror decorations over the anchors, plus a
findings strip that lists them with counts by rule. Clicking a finding scrolls to
it. Done when typing a banned construction marks it within a keystroke.

**1.3 Voice rule sets.** Depends on 1.1 and on 2.1, which is where the database
it writes suppressions into arrives. `voice.md` files that cascade root, group,
document, the nearest level winning any rule or threshold it names. Suppressions
persist in SQLite against the quote anchor, so a deliberate rule break stays
quiet through edits. Done when a suppressed finding stays suppressed after the
surrounding paragraph is rewritten.

## Phase 2: Groups and documents

**2.1 The data directory.** Built in the first wave, not this one, because 1.3
needs it. `.inkling/` inside the vault, SQLite at
`.inkling/inkling.db`, schema and migrations. Done when the app creates it on
first open of a vault that lacks one, and an existing flat vault still opens.

**2.2 Groups as directories.** Navigation, per-group document lists, create,
rename, move. Renaming is the hard part: anything keyed by path in SQLite has to
follow. Done when renaming a group preserves its conversations, references and
suppressions.

**2.3 Document kinds.** Article, email, proposal, note. Frontmatter conventions
and per-kind templates. Done when a new document of each kind opens with the
right skeleton.

**2.4 Name filtering.** One filter box over groups and documents. Deliberately
not search.

## Phase 3: Context management

**3.1 References.** A document or group holds references: other vault documents,
web links, and notes. Metadata in SQLite, note bodies as markdown in the vault.
Done when a reference added at group level appears in every document's assembled
context.

**3.2 The context strip, for real.** Today it shows the open document and the
selection. It becomes the assembled cascade, with each entry's token estimate and
where it was inherited from. Done when the strip accounts for every byte a turn
would carry.

## Phase 4: The agent

Waits on toryo `82bcbabe`.

**4.1 Dispatch transport.** Replace `stubTransport`. Read the token from
`$HOME/.toryo/daemon-token` through a Tauri fs scope and pass it to the
held-session client. The path is pinned rather than following `TORYO_HOME`,
decided in toryo run `369e3146` for the same reason `crashDir` and
`sequenceDraftsDir` are pinned: a Tauri capability is static JSON baked into the
binary and cannot follow an environment variable.

Nothing rotates the token: the daemon mints one only when the file is absent or
blank, and reads it per request. So re-read and retry once on an authorization
failure, but distinguish the two causes. A changed file means retry and carry on.
An absent one means every request will 401 forever, so stop and say the token is
missing and the daemon needs restarting to mint a new one.

Open a held session with the working directory at the vault root and an empty
`writeScope`, since a 4a conversation writes nothing. Stream the session's own
Server-Sent Events, which are gated: the token travels in a request header, and
the browser's built-in event-stream API takes a URL and cannot set one, so the
stream is read with `fetch` instead. Daemon down shows an error. Done when a turn
round-trips and the panel streams it.

**4.2 Sessions.** Several conversations per document, persisted in SQLite, one
turn record per round trip with the pre-turn snapshot. A turn still in flight
when the window went cannot be recovered, whatever the daemon says about its
session: the event stream carries no backlog, so a reply that landed meanwhile is
gone and the turn reads as interrupted rather than as an answer. Done when
closing and reopening the app brings a conversation back with every turn in it,
the unfinished one included and marked as such.

**4.3 Turn taking.** Focus-derived mode, the pin, the indicator, and the three
reply kinds. Both edit paths: landed on disk and read back on the agent's turn,
held as a proposal for accept or reject on the writer's. A held session has no
structured return, so the reply contract is prose in the prompt and a validator
on arrival. See [`turn-taking.md`](./turn-taking.md). Done when the agent asks
before writing while the cursor is in the editor, and does not while it is in
the chat.

**4.4 Anchored highlighting, both directions.** A selection reaches the agent as
context; a reply's anchor scrolls and highlights the editor. Quote anchors, never
line numbers. Done when an anchor still resolves after the paragraph above it is
rewritten.

**4.5 Voice guidance in the prompt.** The cascade assembled into the turn,
compact rules always, each level's long guidance only on the first turn of a
session or when the checker is firing.

## Phase 5: Research inflow

**5.1 Retrieval.** The agent fetches a URL inside its turn. Done when a pasted
link comes back as something discussable.

**5.2 Distillation.** The conversation decides what matters and the agent writes
it as a reference note. The page itself is never cached, which is also what
keeps it from going stale. Done when a link becomes a note that survives the
conversation that produced it.

## Phase 6: Output

**6.1 Export.** A clean markdown file, frontmatter stripped or kept by choice.

**6.2 Rich clipboard.** Markdown rendered to HTML and written to the clipboard
alongside the plain text, so a draft pastes into Apple Mail as formatted text.

**6.3 Revisions.** A button that snapshots the current document into `.inkling/`
as the next revision, and a list to read them back. Manual, never automatic.

---

## Not scheduled

Tags cutting across groups. Full-text search. Anything to do with publishing
targets. All of it is plausible; none of it is needed to write the first article.

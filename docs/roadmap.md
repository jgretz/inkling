# Roadmap

The order of work, decomposed by writer-facing outcome rather than by layer.
Each item is one toryo code-task. [`model.md`](./model.md) is the decided model
these build toward.

## Sequencing

Phases one through three depend on nothing outside this repo and can proceed
while the toryo dispatch work lands. Phase four waits on toryo. Phases five and
six follow it.

| toryo run                              | Gives inkling                 | Blocks                         |
| -------------------------------------- | ----------------------------- | ------------------------------ |
| `b7c44602` HTTP write plane            | The transport                 | `82bcbabe`                     |
| `82bcbabe` browser-safe client subpath | What inkling actually imports | Phase 4                        |
| `b18e6297` resumable sessions          | Warm turns                    | Phase 4 quality, not its start |
| `20b2dd3f` held-open sessions          | Conversational latency        | Nothing; upside only           |

Phase four can start on `82bcbabe` alone. Resume makes it good rather than
possible.

## In flight

| Run        | Item                                 | Waits on |
| ---------- | ------------------------------------ | -------- |
| `0c1d4c6b` | 1.1b detector fixes                  | nothing  |
| `a4df40bf` | 1.2 findings in the editor           | 1.1b     |
| `0f335217` | 1.3 voice rule sets and suppressions | 1.2      |

Serialized rather than parallel: 1.2 builds the findings strip and 1.3 adds the
dismiss affordance to it, so they would collide in the same files.

1.1 and 2.1 are merged. 2.1 was pulled forward out of phase two because 1.3
stores suppressions in the database it creates. The phase numbering records what
each item is, not the order it is built in.

1.1b exists because 1.1's detectors were tuned against specification prose
written by someone thinking about the rules, which never breaks them. Against
1,867 words of real writing in `examples/vault/personal-readme.md` they showed
two bugs in `rule-of-three`, a false positive in `negative-parallelism`, and one
missing rule: the spaced hyphen, which appears 43 times in that file and was
caught zero times.

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
it writes suppressions into arrives. Markdown files that cascade root, group,
document, with a document able to suppress an inherited rule. Suppressions persist in SQLite
against the quote anchor, so a deliberate rule break stays quiet through edits.
Done when a suppressed finding stays suppressed after the surrounding paragraph
is rewritten.

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
`$HOME/.toryo/daemon-token` through a Tauri fs scope and pass it to
`createHttpClient`. The path is pinned rather than following `TORYO_HOME`,
decided in toryo run `369e3146` for the same reason `crashDir` and
`sequenceDraftsDir` are pinned: a Tauri capability is static JSON baked into the
binary and cannot follow an environment variable.

Nothing rotates the token: the daemon mints one only when the file is absent or
blank, and reads it per request. So re-read and retry once on an authorization
failure, but distinguish the two causes. A changed file means retry and carry on.
An absent one means every request will 401 forever, so stop and say the token is
missing and the daemon needs restarting to mint a new one.

Enqueue with the working directory at the vault root and `writeScope` naming
exactly the files a turn may touch, so two conversations in two groups do not
block each other. Stream over Server-Sent Events; `/events` is deliberately
ungated, so plain `EventSource` works. Daemon down shows an error. Done when a
turn round-trips and the panel streams it.

**4.2 Sessions.** Several conversations per document, persisted in SQLite, one
turn record per round trip with the pre-turn snapshot. Resume a pending turn on
restart the way toryo's designer does. Done when closing and reopening the app
recovers a conversation mid-turn.

**4.3 Turn taking.** Focus-derived mode, the pin, the indicator, and the three
reply kinds. Both edit paths: written through dispatch on the agent's turn,
returned as structured output for accept or reject on the writer's. See
[`turn-taking.md`](./turn-taking.md). Done when the agent asks before writing
while the cursor is in the editor, and does not while it is in the chat.

**4.4 Anchored highlighting, both directions.** A selection reaches the agent as
context; a reply's anchor scrolls and highlights the editor. Quote anchors, never
line numbers. Done when an anchor still resolves after the paragraph above it is
rewritten.

**4.5 Voice guidance in the prompt.** The cascade assembled into the turn,
compact rules always, the long document only on the first turn of a session or
when the checker is firing.

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

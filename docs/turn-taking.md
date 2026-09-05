# Turn taking

Two people, one document. The rule that decides who may write.

## The rule

Mode is **derived from where focus last was**, not from a toggle the writer has
to remember to set.

| Last focus     | Mode          | The agent                |
| -------------- | ------------- | ------------------------ |
| The editor     | Writer's turn | Must ask before writing  |
| The chat panel | Agent's turn  | May write without asking |

This kills the two-cursors problem rather than managing it. When focus is in the
editor the agent is not writing, and when focus is in the chat the writer is not
typing prose. No read-only lock is needed, and none should be added.

Derived is the default, not the whole story: a manual pin overrides it, because
a writer reading the preview still wants the agent working. The indicator says
which is in play, and whether a pin put it there.

**The composer is neutral.** Focus landing in the message box is not a claim on
the turn. A writer whose cursor is in the document types their question into the
chat and still expects to be asked before anything changes under them, so the
panel reports focus from everywhere except the composer. Wanting the agent to
work without clicking around the panel is what the pin is for.

## Two edit paths

The mode picks the path, and they are genuinely different mechanisms.

**Agent's turn.** Inkling applies the edit, writes the file, then reads it back
and replaces the buffer from what disk returned rather than from what was sent.
The agent never holds a write tool: the session runs with a hard write deny, and
opening one that could write is a decision at `openSession` that a live session
cannot take back. The landing queues behind the autosave rather than racing it,
so the two writers over one file cannot leave disk holding the older text.

**Writer's turn.** The reply carries the proposed text and the turn writes
nothing. Inkling renders the replacement and the passage it replaces for accept
or reject, and on accept applies it to the buffer as an ordinary edit. The
autosave then treats it exactly as it treats a keystroke, which is the point:
an accepted proposal is the writer's own change.

The asking path is the faster of the two. No file write, no read-back.

## What a turn returns

A reply is one of four things, and the agent has to say which:

- **An answer.** Prose, no edit involved.
- **An edit made.** Only legal on the agent's turn.
- **An edit proposed.** Text to accept or reject.
- **A passage pointed at.** Changes nothing, so it is legal on either turn.

Prose narrating an intention is not a proposal. The distinction has to be
structural or the permission prompt cannot exist. Prose describing a location is
not a pointer either, for a plainer reason: "the third paragraph" is something
the writer has to go and count, and a quote is something inkling can scroll to.

### The contract

A held session carries no structured return. Its turn frame has `index`,
`finalText`, `usage`, `totalCostUsd`, `isError`, `subtype` and `durationMs`, so
`outputSchema` is not on offer. The contract is therefore prose in the prompt and
a validator on arrival, both under `lib/reply.ts`.

A reply is ordinary prose. When it changes the document, asks to, or points at a
passage in it, it ends with one fenced block tagged `inkling`, holding JSON:

```json
{
  "kind": "proposed",
  "quote": "the passage as it stands now",
  "replacement": "what goes there instead"
}
```

`kind` is `made` or `proposed`. `quote` is copied from the document exactly and
must appear in it only once. `replacement` may be empty, which is a deletion.

A reply that only wants to point somewhere sends the same block without a
replacement:

```json
{
  "kind": "point",
  "quote": "the passage as it stands now"
}
```

Five rules follow. The first keeps the block off the screen, and the rest are
refusals rather than guesses:

- The block never reaches the writer's screen. A streaming filter holds text back
  from the marker onward, so a reply carrying one renders as prose alone. A
  stored reply is read back through the same validator when a conversation is
  re-opened, so the block stays off the screen a week later too.
- Anything that is not one of the four shapes is refused with a reason, rendered
  as a notice with nothing to accept.
- An edit claimed as `made` on a turn that was not authorized is refused. The
  agent does not get to decide afterwards whose turn it was.
- One block per reply, about one passage. A reply naming two is refused whole.
- A block that both points and replaces is two intentions, and is refused rather
  than read as whichever one the prose above it seemed to describe.

Matching is exact and single-occurrence, for an edit and for the quote a pointer
is built from. One rule, in one place: `locate` in `lib/pointer.ts`. A quote that
is gone, and a quote that appears twice, are both answered with a sentence rather
than a guess. Tolerant matching was considered and left out, and the asymmetry is
why: a pointer that landed on the wrong passage would highlight the wrong words,
while an edit that did would rewrite them.

The document is captured with the authorization, and for the same reason. An
edit lands only in the file the turn actually carried: a writer who opened
something else while the agent was thinking gets a sentence instead, because two
documents made from one template share passages and a quote can match in the
wrong one.

## Authorization is captured at send time

A turn authorized when it was sent stays authorized. A writer who fires off a
rewrite and then clicks into the editor while it thinks does not revoke it.
Re-deriving mid-flight is a race, and the race is worse than the edge case.

## Anchoring

Both directions of highlighting use **quote anchors**, never line numbers. The
agent names the text it means plus a little surrounding context; the editor
finds it. Line numbers are wrong the moment a paragraph above them changes,
which in a document being actively edited is immediately.

A **pointer** is one passage somebody pointed at: the quote, and the anchor that
finds it again. Both directions are the same shape. The writer's selection is a
pointer, carried with the turn and shown under their own message in the
transcript; a reply's `point` block becomes one, located in the document the turn
carried. Only the quote is ever sent to the agent, and only the quote is ever
stored: a range would be a lie about a document the writer has gone on editing.

Clicking a pointer resolves its anchor against the draft **as it stands then**,
scrolls to it, selects it and tints it. One tint at a time: a second pointer
replaces the first, Escape dismisses it, and typing clears it, because a
highlight the writer has typed through has stopped being about what they asked.
Revealing changes nothing and writes nothing, and the selection it leaves behind
is the writer's own by the ordinary rules: the passage becomes their selection
for the next turn, and focus landing in the editor makes it their turn.

An anchor that no longer resolves is reported and nothing moves. In the chat that
is a notice where a refused edit would go; in the editor it is a sentence in the
status bar. The writer's selection is session-scoped, like a proposal: it is
answered in the session that raised it and nothing stores it.

## Indicator

Title bar, beside the save state. Two resting states, writer's turn and agent's
turn, plus a transient one while a write is actually in flight. Clicking it
cycles the pin: unpinned, the writer's turn, the agent's, unpinned. The whole
state is in its accessible name, the pin included, because which of two people
may write next is not a thing a glyph can say on its own.

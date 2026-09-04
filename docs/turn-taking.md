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
which is in play.

## Two edit paths

The mode picks the path, and they are genuinely different mechanisms.

**Agent's turn.** The agent writes the file through dispatch. Inkling reads it
back off disk afterwards and replaces the buffer, never trusting the agent's own
account of what it did.

**Writer's turn.** The agent returns proposed text as structured output. Nothing
touches disk. Inkling renders it for accept or reject and applies it to the
buffer locally on accept.

The asking path is the faster of the two. No file write, no second round trip.

## What a turn returns

A reply is one of three things, and the agent has to say which:

- **An answer.** Prose, no edit involved.
- **An edit made.** Only legal on the agent's turn.
- **An edit proposed.** Text to accept or reject.

Prose narrating an intention is not a proposal. The distinction has to be
structural or the permission prompt cannot exist.

## Authorization is captured at send time

A turn authorized when it was sent stays authorized. A writer who fires off a
rewrite and then clicks into the editor while it thinks does not revoke it.
Re-deriving mid-flight is a race, and the race is worse than the edge case.

## Anchoring

Both directions of highlighting use **quote anchors**, never line numbers. The
agent names the text it means plus a little surrounding context; the editor
finds it. Line numbers are wrong the moment a paragraph above them changes,
which in a document being actively edited is immediately.

## Indicator

Title bar, beside the save state. Two resting states, writer's turn and agent's
turn, plus a transient one while a write is actually in flight.

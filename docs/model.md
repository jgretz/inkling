# The model

What inkling is built around. This is the decided part; `roadmap.md` is the
order it gets built in.

## Vault, not repository

A **vault** is a directory of the writer's documents. It lives wherever the
writer keeps it and has nothing to do with this repository. Whether the writer
versions their own prose is their business; inkling never assumes git is
involved. `examples/vault/` in this repo is a development fixture and nothing
more.

## Three levels of context

| Level    | Is                       | Holds                            |
| -------- | ------------------------ | -------------------------------- |
| Root     | The vault                | Voice, knowledge                 |
| Group    | A directory in the vault | Voice, knowledge, references     |
| Document | A markdown file          | Prose, references, conversations |

Groups are directories, so the hierarchy needs no storage of its own. Groups
organize; tags, when they arrive, will cut across. Both voice and references
cascade downward, and a document may suppress an inherited rule.

## Where things live

**Markdown files**, in the vault, for anything worth reading without inkling
open: prose, voice rule sets, distilled research notes. Portable, greppable,
editable anywhere.

**`.inkling/` inside the vault**, holding a SQLite database at
`.inkling/inkling.db` plus whatever flat files earn a place beside it.
Conversation transcripts, reference metadata, voice findings and their
suppressions, and the caches behind search and the document list. All of it is
regenerable or discardable, which is what makes it safe to exclude from a
writer's own version control.

The database is file-based deliberately. No server, no daemon, openable with any
SQLite tool.

## Voice

Voice is two things that cascade together.

**Guidance** is prose rules assembled into the agent's prompt. Compact rules
always; the long document read only on the first turn of a session or when the
checker is firing, which is the same conditional-reference discipline toryo's
sequence designer uses and for the same reason.

**Checks** are deterministic detectors run over the draft: regular expressions
for em dashes, curly quotes, negative parallelism, Title Case headings, and
statistical passes for triplets, transition stacking and sentence-length
uniformity. They are pure functions over text. They run locally, instantly, on
every keystroke, at no model cost, and they need neither an agent nor a network.

That second half is what gives inkling a fast feedback loop regardless of how
slow a model turn is.

Prior art is [AI-Writing-Rules](https://github.com/Abdulkader-Safi/AI-Writing-Rules),
which splits the same way: rules injected at session start, detectors run after
each write. If its rule set ships as a default root voice it ships with
attribution.

## The agent

Routed through toryo dispatch. See [`agent.md`](./agent.md) for the transport
and [`turn-taking.md`](./turn-taking.md) for who is allowed to write when.

Conversations attach to a document, several per document, persisted in SQLite.
Every turn is a dispatch job. There is no long-lived session until toryo grows
one.

## Output

Two exits, both small. A clean markdown file on disk, and rich text on the
clipboard so a draft pastes into Apple Mail as formatted text rather than as
markdown source.

Revisions are manual. A button that says "this is the next revision" snapshots
into `.inkling/`. The live document is what matters; history is a convenience.

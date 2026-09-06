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
cascade downward, and the nearest level to the document has the last word on any
rule it names.

## Where things live

**Markdown files**, in the vault, for anything worth reading without inkling
open: prose, voice rule sets, distilled research notes. Portable, greppable,
editable anywhere.

**`.inkling/` inside the vault**, holding a SQLite database at
`.inkling/inkling.db` plus whatever flat files earn a place beside it.
Conversation transcripts, reference metadata, voice findings and their
suppressions, kept revisions, and the caches behind search and the document
list. Most of it is regenerable or discardable, which is what makes it safe to
exclude from a writer's own version control. Kept revisions are the exception,
and the reason that is now a qualified claim: a revision is a version of a
document that has since been rewritten, so nothing can rebuild it, and unlike
the transcripts beside it the app offers it back as something to rely on.
Deleting `.inkling/` deletes them.

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

### Rule sets

Both halves live in one file, `voice.md`, sitting in the directory it governs.
Its YAML frontmatter turns rules on and off and moves thresholds; its body is
the guidance prose. One file, because the guidance and the configuration are the
same decision written twice otherwise.

```markdown
---
rules:
  em-dash: off
thresholds:
  wordsPerTriplet: 300
---

Short sentences. Never open with throat clearing.
```

The cascade is the vault root, then each directory on the way down, then the
document's own `voice:` frontmatter key. **The last level to mention a rule or a
threshold wins it**, in both directions: a document may turn a rule back on that
its group turned off, exactly as it may move a threshold its group moved. A file
the writer can read has to mean what it says at every level.

`on` and `off` mean what a writer expects, though YAML 1.2 hands them over as
strings rather than booleans. Anything else a rule is set to is reported in the
status bar and ignored, never read as "off": a typo that silently disabled a
rule would be indistinguishable from a rule someone meant to disable.

### Dismissals

A finding the writer disagrees with is dismissed, and the dismissal is stored
against the finding's quote anchor rather than its offsets. Rewriting the
paragraph around it moves every offset and changes nothing: the quote plus the
text either side of it is what identifies the passage.

A dismissal is kept until the writer restores it, which they do from the
Dismissed group at the end of the findings strip. Two things end one instead:
deleting the flagged text, since what was judged no longer exists, and rewriting
its surroundings past recognition.

Dismissing is one finding at one place. Turning a rule off everywhere is what
the rule set is for.

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

Revisions are manual. One menu item says "this is the next revision" and keeps
the whole document, frontmatter and body, as a row in `.inkling/inkling.db`;
another lists them newest first, shows one, and writes it back over the live
document once the writer agrees. Nothing is ever snapshotted automatically, and
a document nobody has snapshotted holds no rows at all. The live document is
what matters; history is a convenience.

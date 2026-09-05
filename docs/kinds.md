# Kinds

A document's kind is what it is being written as. inkling knows four, and the
list is short on purpose: it is the writing this app is for, not a taxonomy of
everything a markdown file could be.

| kind       | what it is                                                             |
| ---------- | ---------------------------------------------------------------------- |
| `article`  | A piece written to be published somewhere, on a blog or in a magazine. |
| `email`    | A message to a named person, where the shape is the argument.          |
| `proposal` | An offer of work: the problem, the plan, the price.                    |
| `note`     | Everything not yet one of the other three.                             |

`DOC_KINDS` in `packages/vault/src/types.ts` is the list, and everything else
derives from it: the type, the picker in the library, the templates below.

## Frontmatter

Every kind writes the three keys inkling itself reads:

```yaml
---
title: On Endings
kind: proposal
createdAt: 2026-09-05T09:41:12.104Z
---
```

Nothing writes `updatedAt`. Saving does not set it, and the library falls back
to the file's modification time when it is absent, so a document that claimed
one at creation would show the wrong date forever.

Each kind then suggests its own keys, written empty for the writer to fill in:

| kind       | keys               |
| ---------- | ------------------ |
| `article`  | `publication`      |
| `email`    | `to`, `subject`    |
| `proposal` | `client`, `status` |
| `note`     | none               |

These live in the frontmatter's `extra` bag, not in the `Frontmatter` type.
`title`, `kind`, `tags`, `createdAt` and `updatedAt` are what inkling reads and
acts on; a `publication` is the writer's own metadata, and `extra` already
round-trips any key it does not know, untouched. Adding a field to the type
would mean inkling promising to do something with it.

## Templates

A new document starts as its kind's template: the frontmatter above, plus a
skeleton body. A proposal gets its four headings, the rest get a title heading.
The skeletons are in `packages/vault/src/templates.ts`.

A writer who wants their own puts a markdown file at `templates/<kind>.md` in
their vault, for example `templates/email.md`:

```markdown
---
to: ''
cc: ''
---

# {{title}}

Hi,
```

That file's body and its frontmatter keys replace the built-in skeleton's, value
and all, so a key is worth writing as an empty string rather than leaving bare:
a bare `to:` is YAML for null, and every document made from the template would
carry a literal `to: null`. Tags carry through the same way, so a template that
declares `tags: [draft]` starts every document it makes as a draft.

`{{title}}` anywhere in the body becomes the document's title. `title`, `kind`
and `createdAt` are still inkling's to write, so an override that names them is
describing the template rather than the document, and its values are dropped.
An `updatedAt` is dropped too, because nothing in inkling refreshes one.

A template is an ordinary markdown file in the vault, so `templates/` shows in
the library as a group like any other, and is edited like anything else.

A vault with no `templates/` directory is not missing anything. The built-in
skeletons are the default precisely so that pointing inkling at a fresh
directory does not write four files into it uninvited.

## Documents written before this

A `kind` inkling does not recognise is dropped as it is parsed, and the
document opens with no kind at all. Its prose is never withheld because its
metadata is stale. Setting the frontmatter to one of the four above is all it
takes to bring it back.

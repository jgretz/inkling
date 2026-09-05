import {parseDoc, serializeDoc} from './frontmatter.ts';
import {type DocKind, type DocPath} from './types.ts';

/**
 * What a new document of each kind starts as.
 *
 * A skeleton is frontmatter conventions plus a body. Every convention key is
 * written with an empty value on purpose: the key is inkling's suggestion and
 * the value is the writer's, so guessing at a publication or a client would put
 * words in their mouth that they then have to notice and delete.
 *
 * The keys live in the frontmatter's `extra` bag rather than in `Frontmatter`
 * itself. `title`, `kind`, `tags`, `createdAt` and `updatedAt` are what inkling
 * reads; a `publication` or a `client` is the writer's own metadata, and
 * `extra` already round-trips it untouched.
 *
 * Nothing here writes `updatedAt`. Saving a document does not set that key, and
 * the library falls back to the file's mtime when it is absent, so a template
 * that wrote one would freeze the "updated" column at the creation date for the
 * life of the document.
 */

/** The directory a vault keeps its own template overrides in. */
export const TEMPLATE_DIR = 'templates';

/** Stands in for the document's title anywhere in a template body. */
const TITLE_TOKEN = /\{\{title\}\}/g;

type Skeleton = {
  /** Convention keys for this kind, each written empty for the writer to fill. */
  extra: Record<string, string>;
  body: string;
};

const SKELETONS: Record<DocKind, Skeleton> = {
  article: {
    extra: {publication: ''},
    body: `# {{title}}
`,
  },
  email: {
    extra: {to: '', subject: ''},
    body: `# {{title}}
`,
  },
  proposal: {
    extra: {client: '', status: ''},
    body: `# {{title}}

## The problem

## What we would do

## What it costs

## Next steps
`,
  },
  note: {
    extra: {},
    body: `# {{title}}
`,
  },
};

/** Where a vault's own override for a kind lives, relative to its root. */
export function templatePathFor(kind: DocKind): DocPath {
  return `${TEMPLATE_DIR}/${kind}.md` as DocPath;
}

/**
 * The whole file a new document of this kind starts as, frontmatter included.
 *
 * `createdAt` is a parameter rather than a `new Date()` call so the module stays
 * pure: the same arguments always render the same bytes, which is what lets a
 * test assert on one.
 *
 * `override` is the raw source of the writer's own `templates/<kind>.md`, when
 * they have one. It supplies the body and any extra frontmatter keys, replacing
 * the built-in skeleton's. It does not supply `title`, `kind` or `createdAt`:
 * those describe the document being made, not the shape it is being made in, so
 * an override's own values for them are dropped rather than copied into every
 * document created from it.
 */
export function templateFor(
  kind: DocKind,
  title: string,
  createdAt: string,
  override?: string,
): string {
  const skeleton = SKELETONS[kind];
  const source = override === undefined ? undefined : parseDoc(override);
  const extra = source === undefined ? skeleton.extra : source.frontmatter.extra;
  const body = source === undefined ? skeleton.body : source.body;

  return serializeDoc({
    frontmatter: {title, kind, createdAt, extra: {...extra}},
    body: body.replace(TITLE_TOKEN, title),
  });
}

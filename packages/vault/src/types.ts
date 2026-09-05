/**
 * A vault is a directory of markdown files. Everything inkling knows about a
 * document is either its path or something parsed out of the file itself, so
 * the model here stays a plain description of bytes on disk.
 */

/** Absolute path to the directory holding a vault's markdown files. */
export type VaultPath = string & {readonly __brand: 'VaultPath'};

/** Path of a document relative to its vault root, always POSIX separated. */
export type DocPath = string & {readonly __brand: 'DocPath'};

/**
 * Path of a group relative to its vault root, always POSIX separated and never
 * empty.
 *
 * A group is a directory, so this is exactly the directory portion of the paths
 * of the documents inside it. There is nothing else to a group: no id, no row,
 * no membership list. The vault root is not one, which is why the empty string
 * is not a `GroupPath`.
 */
export type GroupPath = string & {readonly __brand: 'GroupPath'};

/**
 * The kinds of writing inkling is built for: a blog article, an email, a
 * proposal, and a note for everything that is none of those yet. Drives
 * templates and prompts.
 */
export const DOC_KINDS = ['article', 'email', 'proposal', 'note'] as const;

export type DocKind = (typeof DOC_KINDS)[number];

/**
 * Frontmatter inkling itself understands. Any other key a writer puts in the
 * block round-trips untouched through `extra`.
 */
export type Frontmatter = {
  title?: string;
  kind?: DocKind;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  extra: Record<string, unknown>;
};

/** A document split into its frontmatter block and its markdown body. */
export type ParsedDoc = {
  frontmatter: Frontmatter;
  body: string;
};

/**
 * What the document list needs, without loading bodies. Produced by scanning a
 * vault directory; `title` falls back through frontmatter, first heading, then
 * filename.
 */
export type DocSummary = {
  path: DocPath;
  title: string;
  kind: DocKind | undefined;
  tags: string[];
  updatedAt: string;
  words: number;
};

/** A document loaded in full, as the editor holds it. */
export type Doc = DocSummary & {
  /** The raw file contents, frontmatter block included. */
  source: string;
};

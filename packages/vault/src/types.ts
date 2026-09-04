/**
 * A vault is a directory of markdown files. Everything inkling knows about a
 * document is either its path or something parsed out of the file itself, so
 * the model here stays a plain description of bytes on disk.
 */

/** Absolute path to the directory holding a vault's markdown files. */
export type VaultPath = string & {readonly __brand: 'VaultPath'};

/** Path of a document relative to its vault root, always POSIX separated. */
export type DocPath = string & {readonly __brand: 'DocPath'};

/** The kinds of writing inkling is built for. Drives templates and prompts. */
export const DOC_KINDS = ['article', 'essay', 'note', 'talk', 'thread'] as const;

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

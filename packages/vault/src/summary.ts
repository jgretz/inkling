import {parseDoc} from './frontmatter.ts';
import type {Doc, DocPath, DocSummary} from './types.ts';

/** Fenced code blocks, inline code, and link/image syntax, stripped for counting. */
const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]*`/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKUP = /[#>*_~\-|]/g;

/**
 * Word count over prose only. Code blocks and link targets are not writing, and
 * counting them makes the number useless as a sense of how long the piece is.
 */
export function countWords(body: string): number {
  const prose = body
    .replace(CODE_FENCE, ' ')
    .replace(INLINE_CODE, ' ')
    .replace(LINK, '$1')
    .replace(MARKUP, ' ');
  const words = prose.split(/\s+/).filter(function (word) {
    return word.length > 0;
  });
  return words.length;
}

/** The first ATX heading in a body, without its hashes. */
export function firstHeading(body: string): string | undefined {
  const match = body.match(/^#{1,6}\s+(.+)$/m);
  return match?.[1]?.trim();
}

/** Filename without directories or the `.md` extension, as a last-resort title. */
export function titleFromPath(path: DocPath): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.mdx?$/i, '');
}

/**
 * Derives everything the document list shows from a file's contents. Title
 * resolution is deliberately ordered: an explicit frontmatter title beats the
 * first heading, which beats the filename.
 */
export function summarize(path: DocPath, source: string, mtime: string): DocSummary {
  const {frontmatter, body} = parseDoc(source);
  return {
    path,
    title: frontmatter.title ?? firstHeading(body) ?? titleFromPath(path),
    kind: frontmatter.kind,
    tags: frontmatter.tags ?? [],
    updatedAt: frontmatter.updatedAt ?? mtime,
    words: countWords(body),
  };
}

/** The same derivation, keeping the source for an editor to open. */
export function loadDoc(path: DocPath, source: string, mtime: string): Doc {
  return {...summarize(path, source, mtime), source};
}

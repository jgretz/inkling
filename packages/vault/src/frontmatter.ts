import {parse, stringify} from 'yaml';
import {DOC_KINDS, type DocKind, type Frontmatter, type ParsedDoc} from './types.ts';

/** Opening and closing fence of a YAML frontmatter block. */
const FENCE = '---';

/** Keys inkling owns; everything else in the block is carried in `extra`. */
const KNOWN_KEYS = ['title', 'kind', 'tags', 'createdAt', 'updatedAt'] as const;

function isDocKind(value: unknown): value is DocKind {
  return typeof value === 'string' && (DOC_KINDS as readonly string[]).includes(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(function (entry): entry is string {
    return typeof entry === 'string';
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** An empty block, so callers never branch on frontmatter being absent. */
export function emptyFrontmatter(): Frontmatter {
  return {extra: {}};
}

/**
 * Splits a markdown file into its frontmatter and body.
 *
 * A file with no leading `---` fence parses as an empty block plus the whole
 * file as body, which is the common case for something written elsewhere and
 * dropped into the vault. An unterminated or malformed block is treated the
 * same way rather than throwing: the writer's text is never withheld because
 * its metadata is broken.
 */
export function parseDoc(source: string): ParsedDoc {
  const normalized = source.replace(/^﻿/, '');
  if (!normalized.startsWith(FENCE)) return {frontmatter: emptyFrontmatter(), body: normalized};

  const lines = normalized.split('\n');
  const closing = lines.findIndex(function (line, index) {
    return index > 0 && line.trimEnd() === FENCE;
  });
  if (closing === -1) return {frontmatter: emptyFrontmatter(), body: normalized};

  const block = lines.slice(1, closing).join('\n');
  const body = lines
    .slice(closing + 1)
    .join('\n')
    .replace(/^\n/, '');

  let raw: unknown;
  try {
    raw = parse(block);
  } catch {
    return {frontmatter: emptyFrontmatter(), body: normalized};
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {frontmatter: emptyFrontmatter(), body};
  }

  const record = raw as Record<string, unknown>;
  const extra = Object.fromEntries(
    Object.entries(record).filter(function ([key]) {
      return !(KNOWN_KEYS as readonly string[]).includes(key);
    }),
  );

  return {
    frontmatter: {
      title: asString(record['title']),
      kind: isDocKind(record['kind']) ? record['kind'] : undefined,
      tags: asStringArray(record['tags']),
      createdAt: asString(record['createdAt']),
      updatedAt: asString(record['updatedAt']),
      extra,
    },
    body,
  };
}

/**
 * Renders frontmatter and body back into a file. A block with nothing in it is
 * omitted entirely, so a plain markdown file stays a plain markdown file.
 */
export function serializeDoc({frontmatter, body}: ParsedDoc): string {
  const record: Record<string, unknown> = {};
  if (frontmatter.title !== undefined) record['title'] = frontmatter.title;
  if (frontmatter.kind !== undefined) record['kind'] = frontmatter.kind;
  if (frontmatter.tags !== undefined && frontmatter.tags.length > 0) {
    record['tags'] = frontmatter.tags;
  }
  if (frontmatter.createdAt !== undefined) record['createdAt'] = frontmatter.createdAt;
  if (frontmatter.updatedAt !== undefined) record['updatedAt'] = frontmatter.updatedAt;
  Object.assign(record, frontmatter.extra);

  if (Object.keys(record).length === 0) return body;

  return `${FENCE}\n${stringify(record).trimEnd()}\n${FENCE}\n\n${body.replace(/^\n+/, '')}`;
}

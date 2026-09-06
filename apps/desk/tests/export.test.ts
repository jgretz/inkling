import {describe, expect, it} from 'bun:test';
import {parseDoc} from '@inkling/vault';
import {
  defaultExportPath,
  exportDirectory,
  exportFileName,
  exportSource,
} from '../src/lib/export.ts';

const DOC = `---
title: A piece
kind: article
tags:
  - draft
odd_key: kept
---

# A piece

The body, which is the only part an editor asked for.
`;

describe('exportSource', function () {
  it('should drop exactly the frontmatter block when stripping', function () {
    expect(exportSource(DOC, 'strip')).toBe(parseDoc(DOC).body);
  });

  it('should leave no metadata behind when stripping', function () {
    const stripped = exportSource(DOC, 'strip');

    expect(stripped).not.toContain('title:');
    expect(stripped).not.toContain('odd_key');
    expect(stripped).toContain('The body, which is the only part an editor asked for.');
  });

  // Verbatim rather than re-serialised: a round trip through `serializeDoc`
  // would reorder the `extra` keys and reflow YAML the writer typed by hand.
  it('should return the buffer unchanged when keeping', function () {
    expect(exportSource(DOC, 'keep')).toBe(DOC);
    expect(parseDoc(exportSource(DOC, 'keep'))).toEqual(parseDoc(DOC));
  });

  it('should leave a document with no frontmatter alone either way', function () {
    const plain = '# Just prose\n\nNothing above it.\n';

    expect(exportSource(plain, 'keep')).toBe(plain);
    expect(exportSource(plain, 'strip')).toBe(plain);
  });
});

describe('exportFileName', function () {
  it('should be the last segment of a nested path', function () {
    expect(exportFileName('drafts/2026/a-piece.md')).toBe('a-piece.md');
  });

  it('should be the whole path when it names no group', function () {
    expect(exportFileName('a-piece.md')).toBe('a-piece.md');
  });
});

describe('exportDirectory', function () {
  it('should be everything above the chosen file', function () {
    expect(exportDirectory('/Users/josh/Desktop/a-piece.md')).toBe('/Users/josh/Desktop');
  });

  it('should be the root itself for a file written there', function () {
    expect(exportDirectory('/a-piece.md')).toBe('/');
  });

  it('should be nothing when the path names no directory', function () {
    expect(exportDirectory('a-piece.md')).toBeUndefined();
  });
});

describe('defaultExportPath', function () {
  it('should offer the document name in the directory the last export used', function () {
    expect(defaultExportPath('/Users/josh/Desktop', 'drafts/a-piece.md')).toBe(
      '/Users/josh/Desktop/a-piece.md',
    );
  });

  it('should not double the separator for a remembered root directory', function () {
    expect(defaultExportPath('/', 'drafts/a-piece.md')).toBe('/a-piece.md');
  });

  it('should offer the bare name when nothing has been exported yet', function () {
    expect(defaultExportPath(undefined, 'drafts/a-piece.md')).toBe('a-piece.md');
  });
});

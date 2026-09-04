import {describe, expect, it} from 'bun:test';
import {countWords, firstHeading, summarize, titleFromPath} from '../src/summary.ts';
import type {DocPath} from '../src/types.ts';

const path = 'drafts/on-writing.md' as DocPath;
const mtime = '2026-09-04T12:00:00.000Z';

describe('countWords', function () {
  it('should count plain prose', function () {
    expect(countWords('one two three')).toBe(3);
  });

  it('should not count fenced code', function () {
    expect(countWords('one two\n\n```\nconst a = 1;\n```\n')).toBe(2);
  });

  it('should count link text but not the target', function () {
    expect(countWords('see [the guide](https://example.com/a/very/long/path)')).toBe(3);
  });

  it('should return zero for an empty body', function () {
    expect(countWords('')).toBe(0);
  });
});

describe('firstHeading', function () {
  it('should find a heading below the top of the file', function () {
    expect(firstHeading('Intro line\n\n## Second\n\nmore')).toBe('Second');
  });

  it('should return undefined when there is no heading', function () {
    expect(firstHeading('just prose')).toBeUndefined();
  });
});

describe('titleFromPath', function () {
  it('should strip directories and the extension', function () {
    expect(titleFromPath(path)).toBe('on-writing');
  });
});

describe('summarize', function () {
  it('should prefer a frontmatter title over a heading', function () {
    const source = '---\ntitle: Explicit\n---\n\n# Heading\n\nbody';

    expect(summarize(path, source, mtime).title).toBe('Explicit');
  });

  it('should fall back to the first heading when frontmatter has no title', function () {
    expect(summarize(path, '# Heading\n\nbody', mtime).title).toBe('Heading');
  });

  it('should fall back to the filename when there is neither', function () {
    expect(summarize(path, 'body only', mtime).title).toBe('on-writing');
  });

  it('should prefer a frontmatter updatedAt over the file mtime', function () {
    const source = '---\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n\nbody';

    expect(summarize(path, source, mtime).updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

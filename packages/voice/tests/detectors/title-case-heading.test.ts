import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['title-case-heading']});
}

describe('title-case-heading', function () {
  it('should flag a Title Case heading', function () {
    const source = '## How To Ship A Draft';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('How To Ship A Draft');
  });

  it('should flag a Title Case heading below the top of the file', function () {
    expect(findings('Prose.\n\n### What The Panels Are For\n\nMore prose.')).toHaveLength(1);
  });

  it('should not flag a heading that is a proper noun', function () {
    expect(findings('## The New York Times')).toEqual([]);
  });

  it('should not flag a title-cased book title with no function word capitalised', function () {
    expect(findings('## The Sense of Style')).toEqual([]);
  });

  it('should not flag a sentence-case heading', function () {
    expect(findings('## What the panels are for')).toEqual([]);
  });

  it('should not flag a heading of fewer than three words', function () {
    expect(findings('## The End')).toEqual([]);
  });

  it('should not flag a heading inside a fenced code block', function () {
    const source = ['```md', '## How To Ship A Draft', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});

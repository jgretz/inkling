import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['banned-openers']});
}

describe('banned-openers', function () {
  it('should flag a scene-setting opener', function () {
    const source = "In today's tooling, a writer has too many choices.";

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('start with the point');
  });

  it('should flag when it comes to at the start of a sentence', function () {
    expect(findings('The draft is fine. When it comes to structure, it is not.')).toHaveLength(1);
  });

  it('should not flag the same phrase mid-sentence', function () {
    expect(findings('The draft is weakest when it comes to structure.')).toEqual([]);
  });

  it('should raise one finding per sentence even when two formulas match', function () {
    expect(findings('In conclusion, when it comes to drafts, cut the opener.')).toHaveLength(1);
  });

  it('should not flag inside a blockquote', function () {
    expect(findings('> In conclusion, the panel is quiet.')).toEqual([]);
  });
});

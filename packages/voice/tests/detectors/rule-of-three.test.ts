import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['rule-of-three']});
}

describe('rule-of-three', function () {
  it('should flag the triplets past the density budget', function () {
    const source = [
      'The panel handles streaming, cancellation and errors.',
      'The vault holds drafts, references and notes.',
      'The editor tracks the caret, the selection and the scroll.',
    ].join(' ');

    const found = findings(source);

    expect(found).toHaveLength(2);
    expect(found[0]?.explain).toContain('cut one of the three');
  });

  it('should leave a single triplet alone in a short document', function () {
    expect(findings('The panel handles streaming, cancellation and errors.')).toEqual([]);
  });

  it('should not flag a comma splice that only looks like a list', function () {
    const source = [
      'The request will 401 forever, so stop and say the token is stale.',
      'The request will 401 forever, so stop and say the token is stale.',
    ].join(' ');

    expect(findings(source)).toEqual([]);
  });

  it('should not flag a two-item list', function () {
    const source = ['Drafts and notes. Drafts and notes.', 'Drafts and notes.'].join(' ');

    expect(findings(source)).toEqual([]);
  });

  /**
   * Three copies, so the density budget has already been spent by the first
   * match and a silent result is the rule's doing rather than the budget's.
   */
  it('should not flag a two-item list whose middle item runs long', function () {
    const source = new Array(3)
      .fill('You get what you need, express your thoughts and opinions.')
      .join(' ');

    expect(findings(source)).toEqual([]);
  });

  it('should not flag a second two-item list whose middle item runs long', function () {
    const source = new Array(3)
      .fill('It is winning out over obstacles, living out ideas and values.')
      .join(' ');

    expect(findings(source)).toEqual([]);
  });

  it('should still flag a real triplet carrying the serial comma', function () {
    // The first sentence is a triplet too, so it absorbs the budget and the
    // three under test are the ones reported.
    const source = [
      'The panel handles streaming, cancellation and errors.',
      'The result is elegant, consistent, and built to last.',
      'When something goes wrong, acknowledge it, learn from it, and solve the reality we are in.',
      'Take care of yourself, be flexible, and communicate openly.',
    ].join(' ');

    const quotes = findings(source).map(function (finding) {
      return finding.anchor.quote;
    });

    expect(quotes).toEqual([
      'The result is elegant, consistent, and built to last',
      'acknowledge it, learn from it, and solve the reality',
      'Take care of yourself, be flexible, and communicate openly',
    ]);
  });

  it('should not flag triplets inside a fenced code block', function () {
    const source = [
      '```ts',
      'const a = [one, two, and three];',
      'const b = [four, five, and six];',
      'const c = [seven, eight, and nine];',
      '```',
    ].join('\n');

    expect(findings(source)).toEqual([]);
  });
});

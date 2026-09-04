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

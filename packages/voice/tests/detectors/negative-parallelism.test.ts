import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['negative-parallelism']});
}

describe('negative-parallelism', function () {
  it('should flag the not X, but Y shape', function () {
    const source = 'Dispatch is not a scheduler, but a queue with a worker on the end.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('delete the negation');
  });

  it('should flag the two-sentence version of the same move', function () {
    expect(findings('It is not a tool. It is a habit.')).toHaveLength(1);
  });

  it('should leave the not only shape to its own rule', function () {
    expect(findings('It is not only fast, but also cheap.')).toEqual([]);
  });

  it('should not flag a plain negation with no contrast', function () {
    expect(findings('The token is not there, and it never was.')).toEqual([]);
  });

  it('should flag the contracted copula', function () {
    expect(findings("It's not a scheduler, but a queue with a worker on the end.")).toHaveLength(1);
  });

  it('should flag an explicit intensifier with no copula in front of it', function () {
    expect(findings('We shipped not merely a checker, but a habit.')).toHaveLength(1);
  });

  it('should not flag ordinary concession after a modal', function () {
    expect(findings('We will not always agree, but I commit to listening.')).toEqual([]);
  });

  it('should not flag inside a fenced code block', function () {
    const source = ['```ts', 'const x = "not a scheduler, but a queue";', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});

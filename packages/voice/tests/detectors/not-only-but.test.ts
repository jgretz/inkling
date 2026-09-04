import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['not-only-but']});
}

describe('not-only-but', function () {
  it('should flag not only X but also Y', function () {
    const source = 'The checker is not only fast but also free.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('not only fast but also');
  });

  it('should flag the correlative without also', function () {
    expect(findings('It is not only cheap but quick.')).toHaveLength(1);
  });

  it('should not flag not the only', function () {
    expect(findings('It is not the only checker, but it is the local one.')).toEqual([]);
  });

  it('should not flag when the sentence ends before the but', function () {
    expect(findings('It is not only fast. Everything else is slow.')).toEqual([]);
  });

  it('should not flag inside inline code', function () {
    expect(findings('The string `not only fast but also free` is a fixture.')).toEqual([]);
  });
});

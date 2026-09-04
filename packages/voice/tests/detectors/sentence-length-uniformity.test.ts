import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['sentence-length-uniformity']});
}

const UNIFORM = [
  'The preview tracks the editor closely.',
  'The editor holds the markdown source.',
  'The agent reads whatever it is given.',
  'The library sits behind a hinge.',
].join(' ');

const VARIED = [
  'It lags.',
  'The editor holds the raw markdown source, which is the thing the writer is actually working on and the thing every other panel is derived from.',
  'Nothing else.',
  'The agent reads what the context strip says it reads, and not one byte more than that.',
].join(' ');

describe('sentence-length-uniformity', function () {
  it('should flag a paragraph whose sentences are all the same length', function () {
    const found = findings(UNIFORM);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('break the rhythm');
  });

  it('should flag the paragraph rather than any one sentence', function () {
    const found = findings(UNIFORM);

    expect(UNIFORM.slice(found[0]?.range.start, found[0]?.range.end)).toBe(UNIFORM);
  });

  it('should not flag a paragraph with varied sentence lengths', function () {
    expect(findings(VARIED)).toEqual([]);
  });

  it('should not flag a uniform paragraph of three sentences', function () {
    const short = UNIFORM.split(' The library')[0] ?? '';

    expect(findings(short)).toEqual([]);
  });

  it('should not flag a four-item bullet list of uniform lines', function () {
    const list = [
      '- The preview tracks the editor closely.',
      '- The editor holds the markdown source.',
      '- The agent reads whatever it is given.',
      '- The library sits behind a hinge.',
    ].join('\n');

    expect(findings(list)).toEqual([]);
  });
});

import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['en-dash-parenthetical']});
}

describe('en-dash-parenthetical', function () {
  it('should flag an en dash used as punctuation', function () {
    const source = 'Switching runtimes – which is rare – starts from an empty store.';

    expect(findings(source)).toHaveLength(2);
  });

  it('should not flag a numeric range', function () {
    expect(findings('The archive covers 2020–2024 and pages 10–20.')).toEqual([]);
  });

  it('should not flag an en dash inside inline code', function () {
    expect(findings('Use `a–b` as the key.')).toEqual([]);
  });
});

import {describe, expect, it} from 'bun:test';
import {check} from '../src/check.ts';

describe('check', function () {
  it('should return findings in document order', function () {
    const source = 'A heading is missing. The — dash is here.\n\n# How To Ship A Draft';

    const starts = check(source).map(function (finding) {
      return finding.range.start;
    });

    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('should run only the detectors named in options', function () {
    const source = 'The — dash and the “quotes”.';

    const ruleIds = new Set(
      check(source, {detectors: ['em-dash']}).map(function (finding) {
        return finding.ruleId;
      }),
    );

    expect([...ruleIds]).toEqual(['em-dash']);
  });

  it('should return nothing when the detector list is empty', function () {
    expect(check('The — dash.', {detectors: []})).toEqual([]);
  });

  it('should ignore an id no detector answers to', function () {
    expect(check('The — dash.', {detectors: ['no-such-rule']})).toEqual([]);
  });

  it('should return ranges that index the original source', function () {
    const source = '---\ntitle: Draft\n---\n\nThe — dash.';

    const finding = check(source, {detectors: ['em-dash']})[0];

    expect(source.slice(finding?.range.start, finding?.range.end)).toBe('—');
  });

  it('should return nothing for an empty document', function () {
    expect(check('')).toEqual([]);
  });
});

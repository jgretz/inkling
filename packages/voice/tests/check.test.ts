import {describe, expect, it} from 'bun:test';
import {check} from '../src/check.ts';

describe('check', function () {
  it('should return findings in document order', function () {
    const source = 'A heading is missing. The — dash is here.\n\n# How To Ship A Draft';

    const starts = check(source).map(function (finding) {
      return finding.range.start;
    });

    // Asserted first: sorted-equals-itself is true of an empty list, so without
    // this the ordering guard survives a `check` that returns nothing at all.
    expect(starts.length).toBeGreaterThan(1);
    expect(starts).toEqual(
      [...starts].sort(function (a, b) {
        return a - b;
      }),
    );
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

  it('should stop raising a triplet when the budget allows one per fewer words', function () {
    // Two triplets in about twenty prose words. The default of one triplet per
    // two hundred words buys a budget of one, so the second is raised; one per
    // five words buys a budget of three, so neither is.
    const source =
      'We keep drafts, references and notes in one place. The desk shows a preview, an editor and a chat.';

    const strict = check(source, {detectors: ['rule-of-three']});
    const relaxed = check(source, {detectors: ['rule-of-three'], thresholds: {wordsPerTriplet: 5}});

    expect(strict.length).toBe(1);
    expect(relaxed).toEqual([]);
  });

  it('should behave as it always has when no threshold is overridden', function () {
    const source =
      'We keep drafts, references and notes in one place. The desk shows a preview, an editor and a chat.';

    expect(check(source, {detectors: ['rule-of-three'], thresholds: {}})).toEqual(
      check(source, {detectors: ['rule-of-three']}),
    );
  });

  it('should leave the thresholds no rule set mentioned at their defaults', function () {
    const source = '## How To Ship A Draft';

    // `titleCaseMinWords` is untouched by the override beside it, so the
    // heading is still flagged.
    const findings = check(source, {
      detectors: ['title-case-heading'],
      thresholds: {wordsPerTriplet: 10},
    });

    expect(findings.length).toBe(1);
  });

  it('should stop flagging a heading once it is shorter than the minimum', function () {
    const source = '## How To Ship A Draft';

    const findings = check(source, {
      detectors: ['title-case-heading'],
      thresholds: {titleCaseMinWords: 10},
    });

    expect(findings).toEqual([]);
  });
});

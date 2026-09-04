import {describe, expect, it} from 'bun:test';
import {DEFAULT_DETECTORS} from '../src/constants.ts';
import {DETECTORS, DETECTORS_BY_ID} from '../src/registry.ts';

/**
 * The registered ids, in order, against a hard-coded list. Never a length
 * comparison: a count still passes when a rule is renamed, reordered, or
 * swapped one in one out, which is exactly what a catalogue test exists to
 * catch.
 */
const EXPECTED = [
  'em-dash',
  'en-dash-parenthetical',
  'spaced-hyphen',
  'curly-quotes',
  'negative-parallelism',
  'not-only-but',
  'no-x-no-y-just-z',
  'title-case-heading',
  'bold-term-colon',
  'banned-words',
  'banned-openers',
  'throat-clearing',
  'signposting',
  'rule-of-three',
  'transition-stacking',
  'sentence-length-uniformity',
];

describe('DETECTORS', function () {
  it('should register exactly these ids, in this order', function () {
    const ids = DETECTORS.map(function (detector) {
      return detector.id;
    });

    expect(ids).toEqual(EXPECTED);
  });

  it('should index every registered detector by its id', function () {
    expect([...DETECTORS_BY_ID.keys()]).toEqual(EXPECTED);
  });
});

describe('DEFAULT_DETECTORS', function () {
  it('should enable every registered detector, banned words included', function () {
    expect([...DEFAULT_DETECTORS]).toEqual(EXPECTED);
  });
});

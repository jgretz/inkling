import {describe, expect, it} from 'bun:test';
import {
  BANNED_OPENERS,
  BANNED_WORDS,
  NEGATIVE_PARALLELISM,
  SIGNPOSTING,
  THROAT_CLEARING,
} from '../src/words.ts';
import type {BannedWord, PhraseRule} from '../src/types.ts';

/** Named so a failure prints the offending pattern rather than `[object Object]`. */
function sourceOf(rule: PhraseRule): string {
  return rule.pattern.source;
}

function wordOf(entry: BannedWord): string {
  return entry.word;
}

/** The tables `matchPhrases` runs, which calls `matchAll` and needs the g flag. */
const SCANNED: ReadonlyArray<readonly PhraseRule[]> = [
  NEGATIVE_PARALLELISM,
  THROAT_CLEARING,
  SIGNPOSTING,
];

describe('phrase tables', function () {
  it('should make every scanned pattern global, since matchAll throws without it', function () {
    const notGlobal = SCANNED.flat().filter(function (rule) {
      return !rule.pattern.global;
    });

    expect(notGlobal.map(sourceOf)).toEqual([]);
  });

  it('should anchor every opener to the start of a sentence', function () {
    const unanchored = BANNED_OPENERS.filter(function (rule) {
      return !rule.pattern.source.startsWith('^');
    });

    expect(unanchored.map(sourceOf)).toEqual([]);
  });

  it('should give every rule an explain that tells the writer what to do', function () {
    const rules = [...SCANNED.flat(), ...BANNED_OPENERS, ...BANNED_WORDS];

    const silent = rules.filter(function (rule) {
      return rule.explain.trim().length === 0;
    });

    expect(silent).toEqual([]);
  });
});

describe('BANNED_WORDS', function () {
  it('should hold word patterns that compile with boundaries around them', function () {
    const broken = BANNED_WORDS.filter(function (entry) {
      try {
        new RegExp(`\\b(?:${entry.word})\\b`, 'gi');
        return false;
      } catch {
        return true;
      }
    });

    expect(broken.map(wordOf)).toEqual([]);
  });

  it('should keep every literal-context pattern non-global, since it is reused', function () {
    const stateful = BANNED_WORDS.filter(function (entry) {
      return entry.literalContext?.global === true;
    });

    expect(stateful.map(wordOf)).toEqual([]);
  });
});

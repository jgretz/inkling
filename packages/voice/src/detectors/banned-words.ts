import {findingAt, sentenceAt, spansMask} from '../prose.ts';
import {BANNED_WORDS} from '../words.ts';
import type {BannedWord, Detector, Finding, Prose} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'banned-words';

/** Built once, because a regular expression per keystroke per word is waste. */
const PATTERNS: ReadonlyArray<{entry: BannedWord; pattern: RegExp}> = BANNED_WORDS.map(
  function (entry) {
    return {entry, pattern: new RegExp(`\\b(?:${entry.word})\\b`, 'gi')};
  },
);

/**
 * The sentence around a hit, which is what a literal-sense test reads. Falls
 * back to the match itself when the offset lands outside any sentence, so an
 * entry with a `literalContext` can never crash on a stray match.
 */
function context(prose: Prose, start: number, end: number): string {
  const sentence = sentenceAt(prose, start);
  if (sentence === undefined) return prose.text.slice(start, end);
  return prose.text.slice(sentence.start, sentence.end);
}

function findingsFor(prose: Prose, entry: BannedWord, pattern: RegExp): Finding[] {
  return [...prose.text.matchAll(pattern)]
    .filter(function (match) {
      const end = match.index + match[0].length;
      if (spansMask(prose, match.index, end)) return false;
      if (entry.literalContext === undefined) return true;
      return !entry.literalContext.test(context(prose, match.index, end));
    })
    .map(function (match) {
      return findingAt(prose, ID, match.index, match.index + match[0].length, entry.explain);
    });
}

/**
 * Words that arrive with a model rather than with a thought.
 *
 * Four of them have an ordinary literal sense, and each carries a
 * `literalContext` that suppresses the hit. Unpacking a suitcase is not a tell.
 */
export const bannedWords: Detector = {
  id: ID,
  run: function (prose) {
    return PATTERNS.flatMap(function ({entry, pattern}) {
      return findingsFor(prose, entry, pattern);
    });
  },
};

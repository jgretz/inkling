import {THRESHOLDS} from '../constants.ts';
import {findingAt, spansMask} from '../prose.ts';
import type {Detector, Finding, Prose} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'rule-of-three';

/**
 * An item never opens with a conjunction. Without this, a comma splice like
 * `it will 401 forever, so stop and say the token is stale` has the shape of a
 * triplet without being a list.
 */
const NOT_A_CLAUSE =
  '(?!(?:so|but|because|which|that|when|while|if|then|however|and|or|nor|although|though|since|unless)\\b)';

/**
 * A match may not begin inside a word. Without this the engine fails
 * `NOT_A_CLAUSE` at the `W` of `When`, slides one character, and matches at
 * `hen`, reporting a span that starts mid-word.
 */
const START = "(?<![\\p{L}\\p{N}'’-])";

const WORD = "[\\p{L}\\p{N}'’-]+";

/** One to four words, which is as long as a list item gets before it is a clause. */
const ITEM = `${START}${NOT_A_CLAUSE}${WORD}(?:[ \\t]+${WORD}){0,3}`;

/**
 * The middle item, when no comma separates it from `and`. Its boundaries are
 * the only ones the pattern knows exactly, a comma on the left and `and` on the
 * right, so its length is the one honest signal that `A, B and C` is a list
 * rather than `A, B-and-C`. Two words keeps `drafts, references and notes` and
 * drops `get what you need, express your thoughts and opinions`, where the
 * comma is a clause boundary and the `and` joins a compound inside the
 * predicate.
 *
 * One false positive knowingly survives this guard: `a bridge between
 * developers and stakeholders, technical teams and business leadership`, whose
 * middle item is two words. Telling it from a real list needs part-of-speech
 * knowledge this package does not have.
 */
const SHORT = `${START}${NOT_A_CLAUSE}${WORD}(?:[ \\t]+${WORD}){0,1}`;

/** At least one space, and at most one line break, so a triplet may wrap. */
const GAP = '(?:[ \\t]+\\n?[ \\t]*|\\n[ \\t]*)';

const TRIPLET = new RegExp(`${ITEM},${GAP}(?:${ITEM},|${SHORT})${GAP}and${GAP}${ITEM}`, 'giu');

/**
 * Function words the last item runs on into. The match is a highlight in the
 * editor, so trailing `and the` on the end of it is just noise.
 */
const TRAILING_FILLER =
  /(?:[ \t]+(?:a|an|the|and|or|of|to|in|on|for|with|is|are|was|were|that|which|it|they|we|you|neither|nor))+$/i;

const EXPLAIN =
  'cut one of the three, or split the list into two sentences that say different things.';

/**
 * `A, B and C`, counted against a density budget rather than flagged on sight.
 *
 * A triplet is a legitimate figure; a document made of them is a cadence. The
 * budget is one per two hundred words and never below one, so a short note with
 * a single list is left alone, and only the triplets past the budget are
 * raised.
 */
function overBudget(prose: Prose): Finding[] {
  const words = prose.sentences.reduce(function (total, sentence) {
    return total + sentence.words;
  }, 0);
  const budget = Math.max(1, Math.floor(words / THRESHOLDS.wordsPerTriplet));

  return [...prose.text.matchAll(TRIPLET)]
    .map(function (match) {
      return {start: match.index, end: match.index + match[0].replace(TRAILING_FILLER, '').length};
    })
    .filter(function (span) {
      return span.end > span.start && !spansMask(prose, span.start, span.end);
    })
    .slice(budget)
    .map(function (span) {
      return findingAt(prose, ID, span.start, span.end, EXPLAIN);
    });
}

export const ruleOfThree: Detector = {
  id: ID,
  run: overBudget,
};

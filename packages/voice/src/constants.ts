import type {VoiceThresholds} from './types.ts';

/**
 * Characters of context an anchor keeps on each side. Long enough to tell two
 * occurrences of a short quote apart in a paragraph, short enough that a
 * suppression survives an edit a sentence away.
 *
 * Not part of `VoiceThresholds` and not settable in a rule set: it decides the
 * shape of every anchor, and so the identity of every suppression already
 * stored against one.
 */
const ANCHOR_CONTEXT = 32;

/**
 * Every number a rule set may move, with the corpus tuning that chose it.
 *
 * A detector reads these off its second parameter rather than importing them,
 * so a document that sets `wordsPerTriplet: 400` changes what `check` raises
 * without any module-level state moving underneath the next document.
 */
export const DEFAULT_VOICE_THRESHOLDS: VoiceThresholds = Object.freeze({
  /**
   * Triplet budget, from AI-Writing-Rules: more than one `A, B and C` per two
   * hundred words reads as a pattern rather than a choice. Findings are raised
   * only on the triplets past the budget, and the budget is never below one, so
   * a short note with a single list is left alone.
   *
   * Tuned against `bun scripts/voice-report.ts`. Over the nine files of
   * `docs/*.md` and `examples/vault/` the budget leaves 21 of the 31 matched
   * triplets alone and raises 10. Eight of the ten are in
   * `examples/vault/personal-readme.md`, the real prose that replaced the
   * invented sample text these numbers used to be measured on: its 1,823 prose
   * words buy a budget of nine before one is reported, and all eight it does
   * report are real lists.
   */
  wordsPerTriplet: 200,

  /**
   * Consecutive sentences opening with a formal connective before the run is
   * worth flagging, from AI-Writing-Rules. Two in a row is a writer joining an
   * argument; three is a template.
   *
   * Tuned against `bun scripts/voice-report.ts`: across all 5,263 prose words
   * of the corpus, `examples/vault/personal-readme.md` included, not one
   * sentence opens with a connective, so the corpus says nothing about where
   * the line belongs and the prior art's three stands.
   */
  connectiveRun: 3,

  /**
   * Sentence-length uniformity, from AI-Writing-Rules: a paragraph whose
   * sentence word counts have a standard deviation below this fraction of their
   * mean is metronomic. Below four sentences the statistic says nothing.
   *
   * Tuned against `bun scripts/voice-report.ts`. The corpus has fifteen
   * qualifying paragraphs, at ratios 0.15, 0.24, 0.26, 0.27, 0.35, 0.36, 0.38,
   * 0.39, 0.41, 0.44, 0.51, 0.58, 0.60, 0.68 and 0.74, so this line raises
   * eight of them. `examples/vault/personal-readme.md` supplies seven of the
   * fifteen and five of the eight raised, which is what moved these numbers.
   * Eight in fifteen is a lot for prose written by hand, and fifteen paragraphs
   * is still too thin a sample to move a published threshold on: left at the
   * prior art's 0.4, and reported to 1.2 with the counts rather than quietly
   * tightened.
   */
  uniformityRatio: 0.4,
  uniformityMinSentences: 4,

  /** Words a heading needs before Title Case is a style choice rather than a name. */
  titleCaseMinWords: 3,
});

/**
 * Every tunable number in one place, so a reader can see what the checker's
 * judgment actually rests on. No detector inlines one of these numbers into a
 * regular expression.
 *
 * Kept as one object because `anchor.ts` reads `anchorContext` off it, and
 * because the full set is what a reader wants to see at once. The five
 * configurable ones have exactly one source of truth, above.
 */
export const THRESHOLDS = Object.freeze({
  anchorContext: ANCHOR_CONTEXT,
  ...DEFAULT_VOICE_THRESHOLDS,
});

/**
 * The detectors `check` runs when the caller names none.
 *
 * Everything ships enabled, `banned-words` included. Nothing renders in 1.1, so
 * the default costs a writer nothing until 1.2 wires the findings strip up, and
 * 1.2 revisits it with real counts in hand.
 */
export const DEFAULT_DETECTORS: readonly string[] = Object.freeze([
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
]);

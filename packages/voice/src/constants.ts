/**
 * Every tunable number in one place, so 1.3 has a single thing to make
 * configurable and a reader can see what the checker's judgment actually rests
 * on. No detector inlines one of these numbers into a regular expression.
 */
export const THRESHOLDS = Object.freeze({
  /**
   * Characters of context an anchor keeps on each side. Long enough to tell
   * two occurrences of a short quote apart in a paragraph, short enough that a
   * suppression survives an edit a sentence away.
   */
  anchorContext: 32,

  /**
   * Triplet budget, from AI-Writing-Rules: more than one `A, B and C` per two
   * hundred words reads as a pattern rather than a choice. Findings are raised
   * only on the triplets past the budget, and the budget is never below one, so
   * a short note with a single list is left alone.
   *
   * Tuned against `bun scripts/voice-report.ts`. Over the eight files of
   * `docs/*.md` and `examples/vault/` the budget leaves 11 of the 16 matched
   * triplets alone and raises 5, all of them real lists. The two files in
   * `examples/vault/` match none.
   */
  wordsPerTriplet: 200,

  /**
   * Consecutive sentences opening with a formal connective before the run is
   * worth flagging, from AI-Writing-Rules. Two in a row is a writer joining an
   * argument; three is a template.
   *
   * Tuned against `bun scripts/voice-report.ts`: across all 3,011 prose words
   * of the corpus, not one sentence opens with a connective, so the corpus says
   * nothing about where the line belongs and the prior art's three stands.
   */
  connectiveRun: 3,

  /**
   * Sentence-length uniformity, from AI-Writing-Rules: a paragraph whose
   * sentence word counts have a standard deviation below this fraction of their
   * mean is metronomic. Below four sentences the statistic says nothing.
   *
   * Tuned against `bun scripts/voice-report.ts`. The corpus has eight
   * qualifying paragraphs, at ratios 0.15, 0.24, 0.26, 0.41, 0.44, 0.58, 0.68
   * and 0.74, so this line raises three of them. Three in eight is a lot for
   * prose written by hand, and eight paragraphs is too thin a sample to move a
   * published threshold on: left at the prior art's 0.4, and reported to 1.2
   * with the counts rather than quietly tightened.
   */
  uniformityRatio: 0.4,
  uniformityMinSentences: 4,

  /** Words a heading needs before Title Case is a style choice rather than a name. */
  titleCaseMinWords: 3,
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

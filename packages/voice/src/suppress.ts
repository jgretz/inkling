import {resolvePassage} from './anchor.ts';
import type {Anchor, Finding} from './types.ts';

/**
 * One finding the writer dismissed, as it is stored.
 *
 * Keyed by the anchor rather than by a pair of offsets, which is the whole
 * reason a dismissal survives the paragraph around it being rewritten. There is
 * no id and no timestamp here: those belong to whatever stores the row, not to
 * the matching.
 */
export type Suppression = {
  ruleId: string;
  anchor: Anchor;
};

/**
 * A finding and the dismissal that silenced it.
 *
 * The dismissal travels with the finding because undoing one needs whatever
 * identifies the row it came from, and after an edit the finding's own anchor
 * is no longer the one that was stored. Generic in the suppression so a caller
 * that stores an id gets its id back rather than a lookup problem.
 */
export type SuppressedFinding<S extends Suppression = Suppression> = {
  finding: Finding;
  by: S;
};

/**
 * Splits findings into the ones to show and the ones the writer already
 * dismissed.
 *
 * Each suppression's anchor is resolved against the current draft once, with
 * `resolvePassage`, so a dismissal follows its quote as the text above it grows
 * and shrinks but does not jump to another occurrence of the same text. A finding
 * is suppressed when a suppression with the same rule lands on exactly its
 * range: same rule, same span, same dismissal.
 *
 * A suppression whose quote is gone, or whose landing `resolvePassage` does not
 * accept as the same passage, suppresses nothing. That is the honest answer
 * rather than an error, and it is the known limit of this: rewriting the flagged
 * text itself re-raises the finding, because the thing that was judged no longer exists.
 *
 * `kept` holds the surviving findings in the order they arrived.
 */
export function applySuppressions<S extends Suppression>(
  source: string,
  findings: readonly Finding[],
  suppressions: readonly S[],
): {kept: Finding[]; suppressed: Array<SuppressedFinding<S>>} {
  const silenced = new Map<string, S>();

  suppressions.forEach(function (suppression) {
    const range = resolvePassage(source, suppression.anchor);
    if (range === undefined) return;
    silenced.set(`${suppression.ruleId}:${range.start}:${range.end}`, suppression);
  });

  const kept: Finding[] = [];
  const suppressed: Array<SuppressedFinding<S>> = [];

  findings.forEach(function (finding) {
    const by = silenced.get(`${finding.ruleId}:${finding.range.start}:${finding.range.end}`);
    if (by === undefined) kept.push(finding);
    else suppressed.push({finding, by});
  });

  return {kept, suppressed};
}

import {resolveAnchor, sharedPrefix, sharedSuffix} from './anchor.ts';
import type {Anchor, Finding, Range} from './types.ts';

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
 * How much of an anchor's remembered context must still agree where it landed.
 *
 * `resolveAnchor` always returns its best candidate, however poor: it answers
 * "where is this quote now", not "is this the same passage". For a quote like
 * `—`, which occurs all over a document, that is the difference between a
 * dismissal following its sentence and a dismissal jumping to somebody else's.
 * Deleting the em dash a writer dismissed must not silence the next one down
 * the page, so a landing that kept less than half its neighbours is not the
 * passage that was dismissed.
 */
const MIN_CONTEXT_AGREEMENT = 0.5;

/** Whether a resolved span still reads like the passage the anchor recorded. */
function agrees(source: string, anchor: Anchor, range: Range): boolean {
  const remembered = anchor.prefix.length + anchor.suffix.length;
  // A quote with no neighbours, at both ends of a one-line document. There is
  // nothing to disagree with.
  if (remembered === 0) return true;

  const before = source.slice(Math.max(0, range.start - anchor.prefix.length), range.start);
  const after = source.slice(range.end, range.end + anchor.suffix.length);
  const shared = sharedSuffix(anchor.prefix, before) + sharedPrefix(anchor.suffix, after);

  return shared >= remembered * MIN_CONTEXT_AGREEMENT;
}

/**
 * Splits findings into the ones to show and the ones the writer already
 * dismissed.
 *
 * Each suppression's anchor is resolved against the current draft once, so a
 * dismissal follows its quote as the text above it grows and shrinks. A finding
 * is suppressed when a suppression with the same rule lands on exactly its
 * range: same rule, same span, same dismissal.
 *
 * A suppression whose quote is gone, or whose landing kept too little of its
 * context, suppresses nothing. That is the honest answer rather than an error,
 * and it is the known limit of this: rewriting the flagged text itself
 * re-raises the finding, because the thing that was judged no longer exists.
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
    const range = resolveAnchor(source, suppression.anchor);
    if (range === undefined) return;
    if (!agrees(source, suppression.anchor, range)) return;
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

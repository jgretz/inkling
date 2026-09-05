import {THRESHOLDS} from './constants.ts';
import type {Anchor, Range} from './types.ts';

/**
 * Length of the longest common suffix of two strings.
 *
 * Exported for `suppress.ts`, which scores a resolved span the same way this
 * file scores a candidate. One scoring rule, in one place.
 */
export function sharedSuffix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[a.length - 1 - shared] === b[b.length - 1 - shared]) shared += 1;
  return shared;
}

/** Length of the longest common prefix of two strings. See `sharedSuffix`. */
export function sharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared;
}

/** Every offset at which `quote` occurs in `source`, left to right. */
function occurrences(source: string, quote: string): number[] {
  const found: number[] = [];
  let at = source.indexOf(quote);
  while (at !== -1) {
    found.push(at);
    at = source.indexOf(quote, at + 1);
  }
  return found;
}

/**
 * Records a span of text by what it says and what surrounds it.
 *
 * The alternative, a pair of offsets, is wrong for anything that outlives the
 * keystroke that produced it: a writer fixing a typo in the first paragraph
 * shifts every offset below it, and a suppression stored against one would
 * reappear on a different sentence.
 */
export function createAnchor(source: string, start: number, end: number): Anchor {
  const context = THRESHOLDS.anchorContext;
  return {
    quote: source.slice(start, end),
    prefix: source.slice(Math.max(0, start - context), start),
    suffix: source.slice(end, end + context),
    hint: start,
  };
}

/**
 * Finds an anchor's span in a document that has since been edited.
 *
 * Every occurrence of the quote is scored on how much of the remembered prefix
 * and suffix still agree, so an anchor lands on the right one of several
 * identical sentences even after text has moved. `hint` only breaks a tie,
 * because a document that grew above the quote makes it a lie about position
 * while leaving the surrounding words true.
 *
 * Returns `undefined` when the quoted text is gone, which is the honest answer:
 * whatever was flagged no longer exists to flag.
 */
export function resolveAnchor(source: string, anchor: Anchor): Range | undefined {
  if (anchor.quote.length === 0) return undefined;

  const candidates = occurrences(source, anchor.quote);
  if (candidates.length === 0) return undefined;

  const scored = candidates.map(function (start) {
    const end = start + anchor.quote.length;
    const before = source.slice(Math.max(0, start - anchor.prefix.length), start);
    const after = source.slice(end, end + anchor.suffix.length);
    return {
      start,
      end,
      score: sharedSuffix(anchor.prefix, before) + sharedPrefix(anchor.suffix, after),
      distance: Math.abs(start - anchor.hint),
    };
  });

  const best = scored.reduce(function (winner, candidate) {
    if (candidate.score !== winner.score)
      return candidate.score > winner.score ? candidate : winner;
    return candidate.distance < winner.distance ? candidate : winner;
  });

  return {start: best.start, end: best.end};
}

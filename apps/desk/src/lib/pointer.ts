import {createAnchor, type Anchor} from '@inkling/voice';

/**
 * A passage somebody pointed at, and how to find it again.
 *
 * Both directions of pointing are this one shape. The writer's selection is a
 * pointer; a reply naming a passage is a pointer. What is kept is the quote and
 * the anchor, never a pair of offsets: a pointer outlives the keystroke that
 * made it, and the writer goes on editing above it.
 *
 * Pure, the way `reply.ts` is pure. `createAnchor` and `resolveAnchor` are
 * `@inkling/voice`'s, used as they are; nothing here re-implements them.
 */
export type Pointer = {
  /** The passage as it read in the source the pointer was taken from. */
  quote: string;
  /** What finds it again after the document has moved under it. */
  anchor: Anchor;
};

export type Located = {ok: true; start: number} | {ok: false; reason: string};

export type PointerResult = {ok: true; value: Pointer} | {ok: false; reason: string};

/**
 * Where a quote is in a source, refusing rather than guessing.
 *
 * Exact matching, and exactly one match. A quote that is no longer there, and a
 * quote that could be either of two places, are both answered with a sentence
 * rather than with a position the writer did not mean. This is the rule
 * `applyEdit` applies to an edit and `pointerFor` applies to a pointer, in one
 * implementation so the two cannot drift apart.
 */
export function locate(source: string, quote: string): Located {
  const first = source.indexOf(quote);
  if (first < 0) {
    return {ok: false, reason: 'The passage the agent quoted is not in the document any more.'};
  }
  if (source.indexOf(quote, first + 1) >= 0) {
    return {
      ok: false,
      reason: 'The passage the agent quoted appears more than once, so where it meant is unclear.',
    };
  }
  return {ok: true, start: first};
}

/** A pointer at a span the caller already has the offsets of, such as a selection. */
export function pointerAt(source: string, start: number, end: number): Pointer {
  return {quote: source.slice(start, end), anchor: createAnchor(source, start, end)};
}

/**
 * A pointer at a quote, located in the source it was quoted from.
 *
 * The source is the document as whoever pointed saw it, so the surrounding
 * context the anchor records is the context that was actually there. Resolving
 * against a later draft is `resolveAnchor`'s job, not this one's.
 */
export function pointerFor(source: string, quote: string): PointerResult {
  const found = locate(source, quote);
  if (!found.ok) return found;
  return {ok: true, value: pointerAt(source, found.start, found.start + quote.length)};
}

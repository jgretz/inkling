import {createAnchor, resolveAnchor, type Anchor, type Range} from '@inkling/voice';

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

/**
 * Why a quote could not be turned into one position.
 *
 * A code rather than a sentence, because the same miss is reported in two
 * places and one phrasing does not fit both. An edit's reaches the status bar
 * and has to stand alone as a sentence; a pointer's goes inside the chat's
 * refusal notice, which has already begun one.
 */
export type Miss = 'missing' | 'ambiguous';

export type Located = {ok: true; start: number} | {ok: false; miss: Miss};

export type PointerResult = {ok: true; value: Pointer} | {ok: false; miss: Miss};

export type ResolvedPointer = {ok: true; range: Range} | {ok: false; reason: string};

/**
 * Where a quote is in a source, refusing rather than guessing.
 *
 * Exact matching, and exactly one match. A quote that is no longer there, and a
 * quote that could be either of two places, are both answered with a reason
 * rather than with a position the writer did not mean. This is the rule
 * `applyEdit` applies to an edit and `pointerFor` applies to a pointer, in one
 * implementation so the two cannot drift apart.
 */
export function locate(source: string, quote: string): Located {
  const first = source.indexOf(quote);
  if (first < 0) return {ok: false, miss: 'missing'};
  if (source.indexOf(quote, first + 1) >= 0) return {ok: false, miss: 'ambiguous'};
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
 * against a later draft is {@link resolvePointer}'s job, not this one's.
 */
export function pointerFor(source: string, quote: string): PointerResult {
  const found = locate(source, quote);
  if (!found.ok) return found;
  return {ok: true, value: pointerAt(source, found.start, found.start + quote.length)};
}

/**
 * Where a pointer's passage is in the draft as it stands now.
 *
 * The anchor rather than the offsets the passage was pointed at with, which is
 * what lets a pointer survive the paragraph above it being rewritten. A passage
 * that is genuinely gone is said to be gone, in a sentence for the status bar,
 * and the caller moves nothing.
 */
export function resolvePointer(draft: string, pointer: Pointer): ResolvedPointer {
  const range = resolveAnchor(draft, pointer.anchor);
  if (range === undefined) {
    return {ok: false, reason: 'The passage that was pointed at is not in the document any more.'};
  }
  return {ok: true, range};
}

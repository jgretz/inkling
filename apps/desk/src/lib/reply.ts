import {locate} from './pointer.ts';

/**
 * The reply contract: what a turn is allowed to come back as, and how it is read.
 *
 * A held session carries no structured return. Its turn frame has `index`,
 * `finalText`, `usage`, `totalCostUsd`, `isError`, `subtype` and `durationMs`,
 * and nothing else, so `outputSchema` is not available to inkling. The contract
 * is therefore prose in the prompt (see `agent-prompt.ts`) and a validator here.
 *
 * Everything in this file is pure: no window, no clock, no network. What a turn
 * comes back as is a union rather than a flag, because the permission prompt
 * cannot exist unless the distinction is structural: the four kinds the agent
 * may send, plus the refusal inkling answers a fifth thing with.
 */

/** Opens the one fenced block a reply may carry. See `openingPrompt`. */
export const FENCE = '```inkling';

/** Closes it, and closes any other fenced block the prose happened to hold. */
const CLOSE = '```';

/** One replacement: the text to put in, and the text it stands in for. */
export type Edit = {
  /** The passage as it appears in the document now, quoted exactly. */
  quote: string;
  /** What to put there instead. Empty is a deletion, which is legal. */
  replacement: string;
};

/**
 * What a turn came back as.
 *
 * `made` is only ever produced for a turn that was authorized when it was sent.
 * An agent claiming one on an unauthorized turn is a `refused`, so no caller
 * has to re-check the authorization it already captured.
 *
 * `point` changes nothing and asks for nothing: it names a passage the reply is
 * about, so the chat can offer to show the writer where it is. It is legal on
 * either turn for that reason.
 */
export type AgentReply =
  | {kind: 'answer'; text: string}
  | {kind: 'made'; text: string; edit: Edit}
  | {kind: 'proposed'; text: string; edit: Edit}
  | {kind: 'point'; text: string; quote: string}
  | {kind: 'refused'; text: string; reason: string};

export type EditResult = {ok: true; value: string} | {ok: false; reason: string};

/**
 * Holds text back from the fence marker onward, so the writer never watches
 * JSON arrive in a chat bubble.
 *
 * `push` returns only what is safe to show. A tail that could still turn out to
 * be the start of the marker is withheld until the next chunk settles it, and
 * `end` releases that tail once the turn is over and it plainly was not one.
 * Once the marker has actually been seen the filter is sealed: nothing from it
 * onward is ever emitted, by `push` or by `end`.
 */
export type FenceFilter = {
  push: (chunk: string) => string;
  end: () => string;
};

export function createFenceFilter(): FenceFilter {
  let held = '';
  let sealed = false;

  return {
    push(chunk) {
      if (sealed) return '';
      held += chunk;

      const at = held.indexOf(FENCE);
      if (at >= 0) {
        sealed = true;
        const safe = held.slice(0, at);
        held = '';
        return safe;
      }

      const keep = openingRun(held);
      const safe = held.slice(0, held.length - keep);
      held = held.slice(held.length - keep);
      return safe;
    },
    end() {
      if (sealed) return '';
      const tail = held;
      held = '';
      return tail;
    },
  };
}

/** How much of the tail of `text` is a partial fence marker, and so unsafe yet. */
function openingRun(text: string): number {
  const most = Math.min(text.length, FENCE.length - 1);
  const sizes = Array.from({length: most}, function (_unused, index) {
    return most - index;
  });
  return (
    sizes.find(function (size) {
      return text.endsWith(FENCE.slice(0, size));
    }) ?? 0
  );
}

/**
 * The whole of what a turn said, read as one of the five shapes above.
 *
 * `authorized` is the turn's own authorization as captured when it was sent,
 * never re-derived here: a writer who fires off a rewrite and then clicks into
 * the editor while it thinks has not revoked it.
 */
export function parseReply(raw: string, authorized: boolean): AgentReply {
  const at = raw.indexOf(FENCE);
  if (at < 0) return {kind: 'answer', text: raw.trim()};

  const text = raw.slice(0, at).trim();
  const rest = raw.slice(at + FENCE.length);

  const close = rest.indexOf(CLOSE);
  if (close < 0) return refused(text, 'its block was never closed');
  if (rest.slice(close + CLOSE.length).includes(FENCE)) {
    return refused(
      text,
      'it carried more than one block, and a turn changes or points at one passage',
    );
  }

  const parsed = readJson(rest.slice(0, close));
  if (parsed === undefined) return refused(text, 'its block was not readable as JSON');

  const kind = parsed['kind'];
  if (kind !== 'made' && kind !== 'proposed' && kind !== 'point') {
    return refused(text, `its block asked for "${String(kind)}", which is not a kind of reply`);
  }

  const quote = parsed['quote'];
  if (typeof quote !== 'string' || quote.length === 0) {
    return refused(
      text,
      kind === 'point'
        ? 'its block named no passage to point at'
        : 'its edit block named no passage to replace',
    );
  }

  const replacement = parsed['replacement'];
  if (kind === 'point') {
    if (replacement !== undefined) {
      return refused(text, 'its block asked to point at a passage and to replace it as well');
    }
    return {kind, text, quote};
  }

  if (typeof replacement !== 'string') {
    return refused(text, 'its edit block carried no replacement text');
  }

  if (kind === 'made' && !authorized) {
    return refused(text, 'it changed the document on a turn that was yours, not its own');
  }

  return {kind, text, edit: {quote, replacement}};
}

function refused(text: string, reason: string): AgentReply {
  return {kind: 'refused', text, reason};
}

/** The block's JSON as a record, or `undefined` for anything else it may be. */
function readJson(body: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(body.trim());
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Puts an edit into a source string, refusing rather than guessing.
 *
 * The matching rule is `locate`, shared with pointing: exact, and exactly one
 * match. A quote that is no longer there, and a quote that could go in either of
 * two places, are both answered with a sentence rather than with a replacement
 * the writer did not mean.
 *
 * Deliberately not tolerant. A pointer that resolves onto the wrong passage
 * highlights the wrong words; an edit that did would rewrite them, so an edit
 * matches the text it was given or it does not apply at all.
 */
export function applyEdit(source: string, edit: Edit): EditResult {
  const found = locate(source, edit.quote);
  if (!found.ok) return found;
  return {
    ok: true,
    value:
      source.slice(0, found.start) +
      edit.replacement +
      source.slice(found.start + edit.quote.length),
  };
}

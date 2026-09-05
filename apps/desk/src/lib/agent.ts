import type {DocPath} from '@inkling/vault';
import type {ContextReference} from './references.ts';

/**
 * The agent boundary.
 *
 * Nothing here talks to a model yet. The types are the contract the chat panel
 * codes against, so swapping in a real transport later is one file rather than
 * a rewrite of the panel. See `docs/agent.md` for the options still open.
 */

export type Role = 'writer' | 'agent';

export type Message = {
  id: string;
  role: Role;
  text: string;
  at: string;
  /** True while a reply is still streaming in. */
  pending?: boolean;
};

/**
 * What the agent is allowed to see. Assembled by the chat panel and handed over
 * with each turn, so the writer can always point at the context strip and know
 * what left the machine.
 */
export type AgentContext = {
  /** The document under discussion, if one is open. */
  doc: {path: DocPath; title: string; source: string} | undefined;
  /** Text the writer highlighted in the editor, when they selected any. */
  selection: string | undefined;
  /**
   * The assembled reference cascade: what the document's groups attached, then
   * what the document attached itself. Built by `assembleReferences`, which is
   * also what fixes the order and the token estimate of each entry.
   */
  references: ContextReference[];
};

export type Turn = {
  message: string;
  context: AgentContext;
  history: Message[];
};

/** An agent backend. One method, so a real one can be dropped in unchanged. */
export type AgentTransport = {
  name: string;
  /** Yields the reply in chunks so the panel can render it as it arrives. */
  send: (turn: Turn, signal: AbortSignal) => AsyncIterable<string>;
};

export function emptyContext(): AgentContext {
  return {doc: undefined, selection: undefined, references: []};
}

/** Roughly four characters per token; good enough for a context budget meter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * What the next turn would cost, in the same estimate the strip shows per chip.
 *
 * A reference's `source` is empty when it carries no body: a link, a file the
 * vault has lost, or one this document turned off. So they total to zero here
 * rather than needing a rule of their own, and the header cannot disagree with
 * the chips beneath it.
 */
export function contextTokens(context: AgentContext): number {
  const parts = [
    context.doc?.source ?? '',
    context.selection ?? '',
    ...context.references.map(function (entry) {
      return entry.source;
    }),
  ];
  return parts.reduce(function (total, part) {
    return total + estimateTokens(part);
  }, 0);
}

/**
 * A stand-in transport that reports what it was given instead of answering.
 *
 * It exists so the chat panel is exercised end to end, including streaming and
 * cancellation, before a model is chosen. It never pretends to be an answer.
 */
export const stubTransport: AgentTransport = {
  name: 'stub',
  async *send(turn, signal) {
    const words = [
      'No',
      'model',
      'is',
      'wired',
      'up',
      'yet.',
      `I received ${turn.message.length} characters,`,
      `${contextTokens(turn.context)} tokens of context,`,
      `and ${turn.history.length} earlier messages.`,
    ];
    for (const word of words) {
      if (signal.aborted) return;
      await new Promise(function (resolve) {
        setTimeout(resolve, 40);
      });
      yield `${word} `;
    }
  },
};

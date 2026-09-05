import type {DocPath} from '@inkling/vault';
import type {ContextReference} from './references.ts';
import type {AgentReply} from './reply.ts';

/**
 * The agent boundary.
 *
 * The types here are the contract the chat panel codes against, and they name
 * no backend: the panel handles streaming, cancellation and errors around a
 * `send`, and what is on the other side of it is one file. `dispatch-transport.ts`
 * is the one that ships. See `docs/agent.md` for why it is toryo's held-session
 * plane and what that decided.
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
  /**
   * What has been said so far. The shipped transport ignores it: a held session
   * is a live process that already has the conversation in front of it, and
   * re-sending the history would pay for it twice. It stays on the type because
   * a stateless backend would need it, and the panel is the only thing that
   * knows it.
   */
  history: Message[];
  /**
   * Whether this turn may change the document without asking.
   *
   * Captured by the panel at send time from the mode in force then, and never
   * re-derived afterwards: a writer who fires off a rewrite and then clicks into
   * the editor while it thinks does not revoke it. See `docs/turn-taking.md`.
   */
  authorized: boolean;
};

/**
 * One piece of a turn: prose to render, or the turn's single parsed reply.
 *
 * A union rather than a bare string, because the three reply kinds have to be
 * structural for the accept-or-reject prompt to exist at all. Text chunks
 * arrive as they stream; the reply arrives once, last, and only for a turn that
 * ran to the end.
 */
export type ReplyChunk = {kind: 'text'; text: string} | {kind: 'reply'; reply: AgentReply};

/** An agent backend. One method, so a real one can be dropped in unchanged. */
export type AgentTransport = {
  name: string;
  /** Yields the reply in chunks so the panel can render it as it arrives. */
  send: (turn: Turn, signal: AbortSignal) => AsyncIterable<ReplyChunk>;
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

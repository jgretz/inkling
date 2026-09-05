import type {DocPath} from '@inkling/vault';
import type {Message} from './agent.ts';

/**
 * Stored conversations, as rows and as the messages a panel renders.
 *
 * Pure, the way `references.ts` is pure: the row shapes and the transform from
 * rows to messages live here, and nothing in this file names `bridge.ts`. What
 * actually reaches the database is {@link ConversationStore}, an interface
 * implemented once in `bridge.ts` and passed in from `App.tsx`. A transport and
 * a hook both take one, so both are drivable with no webview.
 */

/**
 * One conversation, as `src-tauri/src/conversations.rs` returns it.
 *
 * A hand-written mirror of the Rust `Conversation`, with
 * `serialises_to_the_shape_the_frontend_reads` in that file pinning the other
 * end.
 */
export type Conversation = {
  id: number;
  docPath: string;
  title: string;
  /** The daemon's live session, or null when this conversation is cold. */
  sessionId: string | null;
  /** What a re-open passes so a new session inherits this one's history. */
  resumeSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Where a turn ended up. Mirrors the CHECK in `0004_conversation.sql`. */
export type TurnState = 'pending' | 'answered' | 'failed' | 'interrupted';

/**
 * One round trip, as `conversations.rs` returns it.
 *
 * Named `StoredTurn` rather than `Turn`, which `agent.ts` already uses for what
 * is about to be sent rather than for what was.
 */
export type StoredTurn = {
  id: number;
  conversationId: number;
  asked: string;
  /** The reply, or the failure's own words when `state` is `failed`. */
  answered: string | null;
  state: TurnState;
  /** The document as it stood before the turn. Written, not yet read. */
  snapshot: string;
  createdAt: string;
};

/**
 * Everything a caller does to stored conversations, as one injected value.
 *
 * An interface rather than eight imports so the transport and the hook can be
 * driven with no webview, and so `bridge.ts` stays the only file naming a Tauri
 * command. `App.tsx` passes the real one; a test passes its own.
 */
export type ConversationStore = {
  list: (docPath: DocPath) => Promise<Conversation[]>;
  create: (docPath: DocPath, title: string) => Promise<Conversation>;
  remove: (id: number) => Promise<void>;
  /** Points a conversation at a session, or at none. Both ids move together. */
  setSession: (
    id: number,
    sessionId: string | null,
    resumeSessionId: string | null,
  ) => Promise<void>;
  listTurns: (conversationId: number) => Promise<StoredTurn[]>;
  /** Records a turn as asked, before a byte of it has left the machine. */
  startTurn: (conversationId: number, asked: string, snapshot: string) => Promise<StoredTurn>;
  finishTurn: (
    id: number,
    state: Exclude<TurnState, 'pending'>,
    answered: string | null,
  ) => Promise<StoredTurn>;
};

/**
 * What a turn interrupted by inkling closing says.
 *
 * It says nothing about the answer because there is nothing to say: a held
 * session's event stream carries no backlog, so a reply that arrived while
 * inkling was shut cannot be recovered from it. Inventing one would be the worse
 * failure, and leaving the bubble blank would read as the agent having answered
 * with silence.
 */
export const INTERRUPTED_TEXT = 'This turn ended while inkling was closed.';

/** The name a conversation gets when the writer has not chosen one. */
export const DEFAULT_TITLE = 'Conversation';

/** The agent's half of one stored turn, as the panel renders it. */
function replyOf(turn: StoredTurn): Message {
  const base = {id: `t${turn.id}a`, role: 'agent' as const, at: turn.createdAt};
  switch (turn.state) {
    case 'answered':
      return {...base, text: turn.answered ?? ''};
    case 'failed':
      return {...base, text: `Failed: ${turn.answered ?? 'the turn did not finish'}`};
    case 'interrupted':
      return {...base, text: INTERRUPTED_TEXT};
    case 'pending':
      // Whatever had streamed in before the window went, which is usually
      // nothing: the row is only updated once the turn ends.
      return {...base, text: turn.answered ?? '', pending: true};
  }
}

/**
 * Stored turns as a panel's message list, oldest first.
 *
 * Two messages per turn, the writer's and the agent's, because that is what the
 * panel shows and what a re-mount has to reproduce exactly. The ids are derived
 * from the row id rather than counted, so the same turn keeps the same React key
 * across a remount.
 */
export function messagesOf(turns: readonly StoredTurn[]): Message[] {
  return turns.flatMap(function (turn) {
    return [
      {id: `t${turn.id}w`, role: 'writer' as const, text: turn.asked, at: turn.createdAt},
      replyOf(turn),
    ];
  });
}

/** The turn still in flight, when the last one is. */
export function pendingTurn(turns: readonly StoredTurn[]): StoredTurn | undefined {
  const last = turns[turns.length - 1];
  return last?.state === 'pending' ? last : undefined;
}

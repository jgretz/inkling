import type {VaultPath} from '@inkling/vault';
import type {ResolvedVoice} from '@inkling/voice';
import {
  HeldStreamError,
  type HeldResult,
  type HeldSessionClient,
  type HeldSessionError,
} from '@inkling/toryo';
import {emptyContext, type AgentContext, type AgentTransport, type Turn} from './agent.ts';
import {followUpPrompt, openingPrompt, WRITING_COMPANION} from './agent-prompt.ts';
import type {Conversation, ConversationStore} from './conversations.ts';
import type {TokenRefresh} from './daemon-token.ts';

/**
 * The agent transport: one conversation, held open on toryo's dispatch daemon.
 *
 * A held session is a live worker process the app pushes messages into, so a
 * turn is not a job. The payload's own `prompt` is the first turn and runs the
 * moment the daemon spawns the worker; everything after it is a bare message
 * onto the same process. That is what makes the conditional-reference discipline
 * in `agent-prompt.ts` free rather than merely cheap.
 *
 * ## Eviction is the lifecycle, not an error
 *
 * The daemon evicts idle sessions. It says so with a 410 carrying a `reason` and
 * a `resumeSessionId`, and re-opening with that id is a resume: the new process
 * inherits the conversation. The writer sees nothing, because nothing went
 * wrong. A crash is the case that does surface, and it surfaces with the
 * daemon's own tail rather than a stand-in sentence.
 *
 * One re-open per turn. A session evicted twice inside one turn is a daemon
 * problem rather than an idle timeout, and looping on it would spend the
 * writer's tokens finding that out.
 *
 * ## The turn row is written before the first byte leaves
 *
 * `startTurn` runs ahead of the request and `finishTurn` runs in a `finally`, so
 * a turn that never comes back is still a row the next launch can find. Without
 * it there would be no way to tell "the agent said nothing" from "inkling was
 * closed mid-answer", and the second must never be rendered as an answer.
 */

/** What the writer is told when there is no token and no retry will help. */
export const TOKEN_MISSING =
  'the toryo daemon token is missing; restart the daemon to mint a new one';

/** The token as the transport reaches it. See `daemon-token.ts` for the reads. */
export type TokenAccess = {
  /** The value the next request will carry, as of the last read. */
  current: () => string | null;
  /** Re-read the file, given the value the refused request carried. */
  refresh: (seen: string | null) => Promise<TokenRefresh>;
};

export type DispatchTransportDeps = {
  client: HeldSessionClient;
  /** The conversation this transport is bound to, as stored. */
  conversation: Conversation;
  /** The vault root, which is the session's working directory. */
  vault: VaultPath;
  store: ConversationStore;
  token: TokenAccess;
  /**
   * The voice cascade in force, read at send time rather than at build time:
   * the writer can edit a `voice.md` between two turns of one conversation.
   */
  voice: () => ResolvedVoice;
  /** Whether the checker is raising findings on the draft as it stands. */
  checkerFiring: () => boolean;
  /**
   * Where a failure the writer should see goes, the status bar in the app.
   *
   * Called with `undefined` at the top of every turn, so a crash the writer has
   * already read does not sit in the status bar for the rest of the session.
   */
  onError: (message: string | undefined) => void;
};

/**
 * A transport plus the one thing `AgentTransport` has no member for.
 *
 * `close` ends the daemon session and keeps its id as the conversation's resume
 * id, so coming back to this conversation resumes rather than starts cold. It is
 * not on `AgentTransport` because that type is the panel's contract and the
 * panel never closes anything: the app does, when the conversation stops being
 * the active one.
 */
export type DispatchTransport = AgentTransport & {
  close: () => Promise<void>;
};

export function createDispatchTransport(deps: DispatchTransportDeps): DispatchTransport {
  /** The daemon session this conversation is talking to, or none yet. */
  let sessionId: string | null = deps.conversation.sessionId;
  /** What a re-open passes so the new session inherits this conversation. */
  let resumeSessionId: string | null = deps.conversation.resumeSessionId;
  /**
   * False while `sessionId` is one this transport read out of the database
   * rather than opened itself. A session id outlives the process that answered
   * to it, so the stored one is a claim to check before it is used.
   */
  let verified = sessionId === null;
  /** What the last turn was sent with, so a follow-up re-sends only the change. */
  let previous: AgentContext | undefined;

  /** Remembers where the conversation stands, in memory and on disk together. */
  async function remember(next: string | null, resume: string | null): Promise<void> {
    sessionId = next;
    resumeSessionId = resume;
    verified = true;
    try {
      await deps.store.setSession(deps.conversation.id, next, resume);
    } catch (error) {
      // The turn itself is unaffected; only the next launch loses the thread.
      console.warn('inkling: could not store the conversation session', error);
    }
  }

  /**
   * Runs a call, retrying once when a 401 turns out to be a token that moved.
   *
   * The two causes want opposite handling and only a re-read tells them apart.
   * A changed file is a token the daemon rotated under a long-lived window, and
   * one retry fixes it. An absent file means every request from here to the
   * daemon's next restart will be refused, so retrying is a slower failure with
   * a worse message.
   */
  async function withToken<T>(run: () => Promise<HeldResult<T>>): Promise<HeldResult<T>> {
    const seen = deps.token.current();
    const first = await run();
    if (first.ok || first.error.status !== 401) return first;

    const refreshed = await deps.token.refresh(seen);
    if (refreshed.state === 'missing') {
      return {ok: false, error: {status: 401, message: TOKEN_MISSING}};
    }
    if (!refreshed.changed) return first;
    return run();
  }

  /** Opens a session for this conversation, resuming where there is one to resume. */
  async function open(turn: Turn): Promise<string> {
    const payload = {
      // No `project.id`: a writer's vault is not a toryo project, and claiming
      // one would pin brain's project scope to something that does not exist.
      project: {name: vaultName(deps.vault), workingDir: deps.vault},
      llm: {provider: 'claude', model: 'default', executionMode: 'held'},
      // `explorer` carries a hard write deny in toryo's own permission policy,
      // which is what holds phase 4a's line that the agent writes nothing. The
      // override is the highest-precedence role instruction, so the session is a
      // writing companion rather than toryo's engineering explorer.
      agent: {orientation: 'explorer', roleInstructionOverride: WRITING_COMPANION},
      prompt: openingPrompt({voice: deps.voice(), context: turn.context, message: turn.message}),
      // Present and empty: this conversation writes nothing. An ABSENT key is
      // what the daemon refuses at 400, and it means the opposite, a lock over
      // the whole working directory.
      writeScope: [],
      // All four default true and would otherwise attach toryo's engineering
      // brain to a prose conversation, append a follow-ups block and a heartbeat
      // block to the persona, and summarise the writer's prose into toryo's
      // memory database.
      attachBrainMcp: false,
      autoPopulateMemory: false,
      captureFollowups: false,
      progressHeartbeat: false,
      ...(resumeSessionId === null ? {} : {resumeSessionId}),
    };

    const opened = await withToken(function () {
      return deps.client.openSession({caller: 'inkling', payload});
    });
    if (!opened.ok) throw new HeldStreamError(opened.error);

    await remember(opened.value.sessionId, opened.value.resumeSessionId ?? resumeSessionId);
    return opened.value.sessionId;
  }

  /**
   * The session to talk to, and whether this call is its first turn.
   *
   * A stored session is checked with `getSession` before it is used. It is a
   * handle to a process, and a daemon that restarted since inkling last ran
   * knows nothing about it, so using it would fail the turn on what is really a
   * cold start.
   */
  async function ensureSession(turn: Turn): Promise<{sessionId: string; first: boolean}> {
    const stored = sessionId;
    if (stored !== null && !verified) {
      const known = await withToken(function () {
        return deps.client.getSession(stored);
      });
      if (known.ok && known.value.state === 'live') {
        verified = true;
      } else {
        // A session the daemon has never heard of cannot be resumed from
        // either, so a refusal keeps whatever resume id the conversation
        // already had rather than adopting a dead one.
        await remember(null, known.ok ? known.value.sessionId : resumeSessionId);
      }
    }

    if (sessionId !== null) return {sessionId, first: false};
    return {sessionId: await open(turn), first: true};
  }

  /**
   * One attempt at one turn, against one session.
   *
   * The stream is attached BEFORE the message is pushed, and the daemon's
   * `hello` is what says the attachment landed. A session's event stream carries
   * no backlog, so posting first would race the reply against the subscribe.
   */
  async function* attempt(
    session: {sessionId: string; first: boolean},
    turn: Turn,
    signal: AbortSignal,
    delivered: {any: boolean},
  ): AsyncGenerator<string> {
    const frames = deps.client.sessionEvents(session.sessionId, signal);

    try {
      const hello = await frames.next();
      if (hello.done) {
        throw new Error('the toryo daemon closed the session stream before it started');
      }

      if (!session.first) {
        const posted = await withToken(function () {
          return deps.client.postMessage(session.sessionId, followUp(turn));
        });
        if (!posted.ok) throw new HeldStreamError(posted.error);
      }

      let spoke = false;
      for (;;) {
        const next = await frames.next();
        if (next.done) {
          // The stream ended without a `turn` or a `closed` frame, so nothing
          // said the turn finished. Returning here would record whatever had
          // arrived as the whole answer, and an empty stream as an empty one.
          throw new Error('the toryo daemon ended the session stream mid-turn');
        }
        const frame = next.value;

        if (frame.kind === 'event') {
          const text = assistantText(frame.event);
          if (text === undefined) continue;
          spoke = true;
          delivered.any = true;
          yield text;
          continue;
        }

        if (frame.kind === 'turn') {
          if (frame.turn.isError) {
            throw new Error(frame.turn.finalText ?? 'the agent turn failed');
          }
          // Only when the turn said nothing as it went. An ordinary reply
          // arrives as message events AND again as `finalText`, and yielding
          // both would render it twice.
          if (!spoke && frame.turn.finalText !== undefined) {
            delivered.any = true;
            yield frame.turn.finalText;
          }
          return;
        }

        if (frame.kind === 'error') throw new Error(frame.message);
        if (frame.kind === 'closed') return;
      }
    } finally {
      // The generator is driven by hand rather than by `for await`, so the
      // stream is cancelled here rather than by the loop that left it.
      await frames.return(undefined);
    }
  }

  /**
   * The text of one turn after the first, which re-sends only what moved.
   *
   * With no `previous`, everything is treated as new. That is the case where
   * this transport was built against a session some earlier instance of it
   * opened, in another mount of the panel: the session has the conversation, but
   * this object has no record of what the writer has edited since, and sending
   * nothing would leave the agent answering about a draft it last saw before
   * those edits.
   */
  function followUp(turn: Turn): string {
    return followUpPrompt({
      voice: deps.voice(),
      context: turn.context,
      previous: previous ?? emptyContext(),
      checkerFiring: deps.checkerFiring(),
      message: turn.message,
    });
  }

  /**
   * One turn, re-opening once where the daemon says the session has gone.
   *
   * The re-open is refused once anything has been delivered: the writer is
   * already reading a reply, and starting it again underneath them would be
   * worse than the failure.
   */
  async function* stream(turn: Turn, signal: AbortSignal): AsyncGenerator<string> {
    const delivered = {any: false};
    let reopened = false;

    for (;;) {
      const session = await ensureSession(turn);
      try {
        yield* attempt(session, turn, signal, delivered);
        return;
      } catch (error) {
        if (!(error instanceof HeldStreamError)) throw error;
        const failure = error.error;

        // A crash is surfaced however far into the turn it reached. It is the
        // one reason that never re-opens, so the budget below has nothing to say
        // about it, and answering it there would drop the daemon's tail on any
        // turn that had already delivered a word or re-opened once.
        if (failure.reason === 'crashed') {
          const message = crashed(failure);
          deps.onError(message);
          await remember(null, resumeSessionId);
          throw new Error(message);
        }

        // One re-open per turn, and none once the writer is reading: restarting
        // a reply underneath them would be worse than the failure, and a session
        // evicted twice inside one turn is a daemon problem rather than an idle
        // timeout.
        if (delivered.any || reopened) throw new Error(failure.message);

        switch (failure.reason) {
          case 'evicted':
            // The ordinary end of an idle session. Nothing is surfaced, because
            // nothing went wrong.
            await remember(null, failure.resumeSessionId ?? session.sessionId);
            reopened = true;
            continue;
          case 'closed':
            // Someone ended this session. A new one for the same conversation,
            // carrying whatever the daemon offered to resume from.
            await remember(null, failure.resumeSessionId ?? resumeSessionId);
            reopened = true;
            continue;
          default:
            throw new Error(failure.message);
        }
      }
    }
  }

  return {
    name: 'toryo',

    async *send(turn, signal) {
      // The last turn's failure has been read by now, and leaving it in the
      // status bar would have it outlive the turn it was about.
      deps.onError(undefined);
      const snapshot = turn.context.doc?.source ?? '';
      const row = await deps.store.startTurn(deps.conversation.id, turn.message, snapshot);

      let answer = '';
      let failure: string | undefined;
      try {
        for await (const chunk of stream(turn, signal)) {
          answer += chunk;
          yield chunk;
        }
        previous = turn.context;
      } catch (error) {
        // A turn the writer stopped is not a failure: what arrived is on screen
        // and is what the row should hold.
        if (signal.aborted) {
          previous = turn.context;
        } else {
          failure = error instanceof Error ? error.message : String(error);
          throw error;
        }
      } finally {
        await deps.store
          .finishTurn(
            row.id,
            failure === undefined ? 'answered' : 'failed',
            failure ?? (answer.length === 0 ? null : answer),
          )
          .catch(function (error) {
            console.warn('inkling: could not record the finished turn', error);
          });
      }
    },

    async close() {
      if (sessionId === null) return;
      const ending = sessionId;
      // Kept as the resume id before the call, so a close that fails still
      // leaves the conversation able to resume rather than only able to start
      // over.
      await remember(null, ending);
      const closed = await withToken(function () {
        return deps.client.closeSession(ending);
      });
      if (!closed.ok && closed.error.status !== 410 && closed.error.status !== 404) {
        console.warn(`inkling: could not close session ${ending}: ${closed.error.message}`);
      }
    },
  };
}

/** The last path segment of the vault directory, which is what a writer named it. */
function vaultName(vault: VaultPath): string {
  return vault.split('/').filter(Boolean).pop() ?? vault;
}

/**
 * The text of an assistant message event, or undefined for every other event.
 *
 * Checked rather than cast: the daemon is a separately-versioned binary, and a
 * tool-use event read as a message would put toryo's internals in front of the
 * writer as if the agent had said them.
 */
function assistantText(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const record = event as Record<string, unknown>;
  if (record.type !== 'message' || record.role !== 'assistant') return undefined;
  return typeof record.text === 'string' ? record.text : undefined;
}

/** A crash, in the daemon's own words, with its tail when there is one. */
function crashed(failure: HeldSessionError): string {
  const tail = failure.tail === undefined ? '' : `: ${failure.tail.trim()}`;
  return `The agent session crashed. ${failure.message}${tail}`;
}

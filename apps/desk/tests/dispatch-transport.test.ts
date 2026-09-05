import {describe, expect, it} from 'bun:test';
import type {DocPath, VaultPath} from '@inkling/vault';
import {resolveVoice} from '@inkling/voice';
import {createHeldSessionClient} from '@inkling/toryo';
import {emptyContext, type AgentContext} from '../src/lib/agent.ts';
import type {
  Conversation,
  ConversationStore,
  StoredTurn,
  TurnState,
} from '../src/lib/conversations.ts';
import type {TokenRefresh} from '../src/lib/daemon-token.ts';
import {createDispatchTransport, type TokenAccess} from '../src/lib/dispatch-transport.ts';

/**
 * The transport, driven end to end against a scripted daemon.
 *
 * No test here needs a daemon, a webview or a global patched: the client takes
 * its `fetch` and the transport takes its store and its token, so a whole turn
 * including an eviction and a re-open is a list of canned responses.
 */

const VAULT = '/Users/writer/vault' as VaultPath;

const CONVERSATION: Conversation = {
  id: 1,
  docPath: 'drafts/a.md',
  title: 'On endings',
  sessionId: null,
  resumeSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** One request the transport made, as the scripted daemon saw it. */
type Call = {
  method: string;
  path: string;
  body: {payload?: Record<string, unknown>; text?: string} | undefined;
  token: string | null;
  /** The caller's abort signal, which a long-lived stream answers to. */
  signal: AbortSignal | null;
};

function live(sessionId: string, resumeSessionId: string | null = null): Response {
  return Response.json({sessionId, state: 'live', resumeSessionId, turns: 0}, {status: 200});
}

/** An SSE response whose body is the frames given, already blank-line delimited. */
function stream(...frames: string[]): Response {
  const body = frames.join('');
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    {status: 200, headers: {'content-type': 'text/event-stream'}},
  );
}

/**
 * An SSE response that sends what it was given and then stays open, the way a
 * session mid-answer does. Aborting the request errors the body, which is what a
 * real `fetch` does and what the writer's stop button reaches.
 */
function held(...frames: string[]) {
  return function (call: Call): Response {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frames.join('')));
          call.signal?.addEventListener('abort', function () {
            controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          });
        },
      }),
      {status: 200, headers: {'content-type': 'text/event-stream'}},
    );
  };
}

function said(text: string): string {
  return `event: event\ndata: ${JSON.stringify({
    event: {type: 'message', role: 'assistant', text},
  })}\n\n`;
}

const HELLO = 'event: hello\ndata: {"sessionId":"s"}\n\n';

function ended(turn: Record<string, unknown>): string {
  return `event: turn\ndata: ${JSON.stringify({turn})}\n\n`;
}

function gone(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {status: 410});
}

/** A daemon that answers the calls in order and records what it was asked. */
function daemon(script: ReadonlyArray<(call: Call) => Response>) {
  const calls: Call[] = [];
  const impl = function (url: URL | string, init?: RequestInit) {
    const target = new URL(String(url));
    const raw = init?.body;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: target.pathname,
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
      token: new Headers(init?.headers).get('x-toryo-daemon-token'),
      signal: init?.signal ?? null,
    };
    calls.push(call);
    const answer = script[calls.length - 1];
    if (answer === undefined) {
      return Promise.reject(new Error(`unscripted ${call.method} ${call.path}`));
    }
    return Promise.resolve(answer(call));
  } as unknown as typeof fetch;
  return {calls, fetch: impl};
}

/** A store that records rather than persists, so a turn's row can be asserted. */
function recording() {
  const turns: StoredTurn[] = [];
  const sessions: Array<{sessionId: string | null; resumeSessionId: string | null}> = [];
  let nextId = 1;

  const store: ConversationStore = {
    list() {
      return Promise.resolve([CONVERSATION]);
    },
    create() {
      return Promise.resolve(CONVERSATION);
    },
    remove() {
      return Promise.resolve();
    },
    setSession(_id, sessionId, resumeSessionId) {
      sessions.push({sessionId, resumeSessionId});
      return Promise.resolve();
    },
    listTurns() {
      return Promise.resolve(turns);
    },
    startTurn(conversationId, asked, snapshot) {
      const row: StoredTurn = {
        id: nextId++,
        conversationId,
        asked,
        answered: null,
        state: 'pending',
        snapshot,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      turns.push(row);
      return Promise.resolve(row);
    },
    finishTurn(id, state: Exclude<TurnState, 'pending'>, answered) {
      const row = turns.find(function (entry) {
        return entry.id === id;
      });
      if (row === undefined) throw new Error(`no turn ${id}`);
      row.state = state;
      row.answered = answered;
      return Promise.resolve(row);
    },
  };

  return {store, turns, sessions};
}

/** A token that is present and never moves, which is the ordinary case. */
function steadyToken(value = 'tok'): TokenAccess {
  return {
    current() {
      return value;
    },
    refresh() {
      return Promise.resolve({state: 'present', changed: false} satisfies TokenRefresh);
    },
  };
}

type Harness = {
  calls: Call[];
  turns: StoredTurn[];
  sessions: Array<{sessionId: string | null; resumeSessionId: string | null}>;
  errors: string[];
  /** How many times the transport cleared the writer-facing failure. */
  cleared: () => number;
  send: (message: string, context?: AgentContext) => Promise<string>;
  /** Sends, then stops the turn the moment the first chunk lands. */
  stopAfterFirstChunk: (message: string) => Promise<string>;
};

function harness(
  script: ReadonlyArray<(call: Call) => Response>,
  options: {token?: TokenAccess; conversation?: Conversation} = {},
): Harness {
  const {calls, fetch: fetchImpl} = daemon(script);
  const {store, turns, sessions} = recording();
  const errors: string[] = [];
  let cleared = 0;
  const token = options.token ?? steadyToken();

  const transport = createDispatchTransport({
    client: createHeldSessionClient({
      endpoint: 'http://daemon.test',
      fetch: fetchImpl,
      token() {
        return token.current() ?? '';
      },
    }),
    conversation: options.conversation ?? CONVERSATION,
    vault: VAULT,
    store,
    token,
    voice() {
      return resolveVoice([]);
    },
    checkerFiring() {
      return false;
    },
    onError(message) {
      if (message === undefined) cleared += 1;
      else errors.push(message);
    },
  });

  return {
    calls,
    turns,
    sessions,
    errors,
    cleared() {
      return cleared;
    },
    async send(message, context = emptyContext()) {
      const controller = new AbortController();
      let text = '';
      for await (const chunk of transport.send(
        {message, context, history: []},
        controller.signal,
      )) {
        text += chunk;
      }
      return text;
    },
    async stopAfterFirstChunk(message) {
      const controller = new AbortController();
      let text = '';
      for await (const chunk of transport.send(
        {message, context: emptyContext(), history: []},
        controller.signal,
      )) {
        text += chunk;
        controller.abort();
      }
      return text;
    },
  };
}

/**
 * The message a send failed with, and a failed test when it did not fail.
 *
 * Written out rather than `expect(...).rejects`, whose bun typing returns void:
 * an un-awaited assertion there is a rejection nothing observes, and a turn that
 * wrongly succeeded would pass.
 */
async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('the turn should have failed but did not');
}

describe('a turn that goes through', function () {
  it('should stream the assistant text and record the turn as answered', async function () {
    const app = harness([
      () => live('s-1'),
      () => stream(HELLO, said('Try '), said('this.'), ended({index: 0, isError: false})),
    ]);

    const reply = await app.send('Tighten this');

    expect(reply).toBe('Try this.');
    expect(app.turns[0]?.state).toBe('answered');
    expect(app.turns[0]?.answered).toBe('Try this.');
  });

  it('should record the turn as asked before the first request leaves', async function () {
    const app = harness([
      (call) => {
        // The row is written ahead of the open, which is the only reason a turn
        // that never comes back can be found at the next launch.
        expect(app.turns).toHaveLength(1);
        expect(call.path).toBe('/sessions');
        return live('s-1');
      },
      () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
    ]);

    await app.send('Tighten this');

    expect(app.turns[0]?.asked).toBe('Tighten this');
  });

  it('should store the document as it stood before the turn', async function () {
    const app = harness([
      () => live('s-1'),
      () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
    ]);
    const context: AgentContext = {
      doc: {path: 'drafts/a.md' as DocPath, title: 'A', source: '# Draft'},
      selection: undefined,
      references: [],
    };

    await app.send('Tighten this', context);

    expect(app.turns[0]?.snapshot).toBe('# Draft');
  });

  // An ordinary reply arrives as message events and AGAIN as the turn's
  // `finalText`. Yielding both would render it twice.
  it('should not yield finalText when the turn already spoke', async function () {
    const app = harness([
      () => live('s-1'),
      () =>
        stream(HELLO, said('Try this.'), ended({index: 0, isError: false, finalText: 'Try this.'})),
    ]);

    const reply = await app.send('Tighten this');

    expect(reply).toBe('Try this.');
  });

  it('should yield finalText when no message event arrived', async function () {
    const app = harness([
      () => live('s-1'),
      () => stream(HELLO, ended({index: 0, isError: false, finalText: 'Quietly done.'})),
    ]);

    const reply = await app.send('Tighten this');

    expect(reply).toBe('Quietly done.');
  });

  it('should push a second turn onto the session it already opened', async function () {
    const app = harness([
      () => live('s-1'),
      () => stream(HELLO, said('First.'), ended({index: 0, isError: false})),
      () => stream(HELLO, said('Second.'), ended({index: 1, isError: false})),
      () =>
        Response.json(
          {sessionId: 's-1', state: 'live', resumeSessionId: null, turns: 2},
          {status: 202},
        ),
    ]);

    await app.send('One');
    const second = await app.send('Two');

    expect(second).toBe('Second.');
    // The stream is attached before the message is pushed: a session's events
    // carry no backlog, so posting first would race the reply.
    expect(app.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /sessions',
      'GET /sessions/s-1/events',
      'GET /sessions/s-1/events',
      'POST /sessions/s-1/messages',
    ]);
  });

  // Returning quietly would record whatever had arrived as the whole answer,
  // and an empty stream as an empty one.
  it('should fail the turn when the stream ends without saying the turn finished', async function () {
    const app = harness([() => live('s-1'), () => stream(HELLO, said('Half a th'))]);

    expect(await failure(app.send('Tighten this'))).toContain('mid-turn');
    expect(app.turns[0]?.state).toBe('failed');
  });

  // The session has the conversation; this transport has no record of what the
  // writer edited since the mount that opened it, so it re-sends the lot.
  it('should send the whole context on the first turn against a session it did not open', async function () {
    const warm: Conversation = {...CONVERSATION, sessionId: 's-old'};
    const app = harness(
      [
        () => live('s-old'),
        () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
        () =>
          Response.json(
            {sessionId: 's-old', state: 'live', resumeSessionId: null, turns: 1},
            {status: 202},
          ),
      ],
      {conversation: warm},
    );
    const context: AgentContext = {
      doc: {path: 'drafts/a.md' as DocPath, title: 'A', source: 'The whole draft.'},
      selection: undefined,
      references: [],
    };

    await app.send('Tighten this', context);

    expect(app.calls[2]?.body?.text).toContain('The whole draft.');
  });

  it('should fail the turn with the daemon words when the turn frame is an error', async function () {
    const app = harness([
      () => live('s-1'),
      () => stream(HELLO, ended({index: 0, isError: true, finalText: 'the model refused'})),
    ]);

    expect(await failure(app.send('Tighten this'))).toBe('the model refused');
    expect(app.turns[0]?.state).toBe('failed');
    expect(app.turns[0]?.answered).toBe('the model refused');
  });
});

describe('a turn the writer stopped', function () {
  // Stopping is not failing: what arrived is on screen, and the row should hold
  // it rather than an error the writer caused on purpose.
  it('should keep what arrived and record the turn as answered', async function () {
    const app = harness([() => live('s-1'), held(HELLO, said('Half a th'))]);

    const reply = await app.stopAfterFirstChunk('Tighten this');

    expect(reply).toBe('Half a th');
    expect(app.turns[0]?.state).toBe('answered');
    expect(app.turns[0]?.answered).toBe('Half a th');
    expect(app.errors).toEqual([]);
  });

  // The generator is driven by hand rather than by `for await`, so nothing but
  // the transport's own `finally` cancels the stream when a turn is stopped.
  it('should not re-open the session it was stopped against', async function () {
    const app = harness([() => live('s-1'), held(HELLO, said('Half a th'))]);

    await app.stopAfterFirstChunk('Tighten this');

    expect(app.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /sessions',
      'GET /sessions/s-1/events',
    ]);
  });
});

describe('a session that was evicted', function () {
  it('should re-open with the resume id and deliver the reply on the same send', async function () {
    const app = harness([
      () => live('s-1'),
      () => gone({error: 'evicted', reason: 'evicted', resumeSessionId: 's-2'}),
      () => live('s-3', 's-2'),
      () => stream(HELLO, said('Still here.'), ended({index: 0, isError: false})),
    ]);

    const reply = await app.send('Tighten this');

    expect(app.calls[2]?.body?.payload?.resumeSessionId).toBe('s-2');
    expect(reply).toBe('Still here.');
    expect(app.errors).toEqual([]);
  });

  it('should re-open at most once, so a session evicted twice fails rather than loops', async function () {
    const app = harness([
      () => live('s-1'),
      () => gone({error: 'evicted', reason: 'evicted', resumeSessionId: 's-2'}),
      () => live('s-3', 's-2'),
      () => gone({error: 'evicted again', reason: 'evicted', resumeSessionId: 's-4'}),
    ]);

    expect(await failure(app.send('Tighten this'))).toBe('evicted again');
    expect(app.calls).toHaveLength(4);
  });
});

describe('a session that crashed', function () {
  it('should surface the daemon tail and not re-open', async function () {
    const app = harness([
      () => live('s-1'),
      () =>
        gone({
          error: 'the session crashed',
          reason: 'crashed',
          exitCode: 1,
          tail: 'panic: out of memory',
        }),
    ]);

    expect(await failure(app.send('Tighten this'))).toContain('panic: out of memory');
    expect(app.errors).toHaveLength(1);
    expect(app.errors[0]).toContain('panic: out of memory');
    expect(app.calls).toHaveLength(2);
  });

  // A crash never re-opens, so the one-re-open budget has nothing to say about
  // it. Letting that budget answer first would report the second failure of a
  // turn as a bare daemon line with the tail dropped.
  it('should still surface the tail when the crash follows an eviction', async function () {
    const app = harness([
      () => live('s-1'),
      () => gone({error: 'evicted', reason: 'evicted', resumeSessionId: 's-2'}),
      () => live('s-3', 's-2'),
      () => gone({error: 'the session crashed', reason: 'crashed', tail: 'panic: out of memory'}),
    ]);

    expect(await failure(app.send('Tighten this'))).toContain('panic: out of memory');
    expect(app.errors).toHaveLength(1);
    expect(app.errors[0]).toContain('panic: out of memory');
    expect(app.calls).toHaveLength(4);
  });

  // Otherwise the crash the writer has already read sits in the status bar for
  // the rest of the session, under whatever they went on to ask.
  it('should clear the writer-facing failure when the next turn begins', async function () {
    const app = harness([
      () => live('s-1'),
      () => gone({error: 'the session crashed', reason: 'crashed', tail: 'boom'}),
      () => live('s-2'),
      () => stream(HELLO, said('Better now.'), ended({index: 0, isError: false})),
    ]);
    await failure(app.send('Tighten this'));
    expect(app.cleared()).toBe(1);

    await app.send('Try again');

    expect(app.cleared()).toBe(2);
    expect(app.errors).toHaveLength(1);
  });
});

describe('the daemon token', function () {
  it('should stop with a message naming the token when the file is absent', async function () {
    const absent: TokenAccess = {
      current() {
        return null;
      },
      refresh() {
        return Promise.resolve({state: 'missing', changed: false} satisfies TokenRefresh);
      },
    };
    const app = harness([() => Response.json({error: 'unauthorized'}, {status: 401})], {
      token: absent,
    });

    expect(await failure(app.send('Tighten this'))).toContain('missing');
    // Exactly one: every later request would be refused the same way, so a
    // retry is a slower failure with a worse message.
    expect(app.calls).toHaveLength(1);
  });

  it('should retry once with the new value when the file changed, on the same client', async function () {
    let value = 'old';
    const rotating: TokenAccess = {
      current() {
        return value;
      },
      refresh(seen) {
        value = 'new';
        return Promise.resolve({state: 'present', changed: value !== seen} satisfies TokenRefresh);
      },
    };
    const app = harness(
      [
        () => Response.json({error: 'unauthorized'}, {status: 401}),
        () => live('s-1'),
        () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
      ],
      {token: rotating},
    );

    const reply = await app.send('Tighten this');

    expect(app.calls[0]?.token).toBe('old');
    expect(app.calls[1]?.token).toBe('new');
    expect(reply).toBe('ok');
  });
});

describe('the opening payload', function () {
  // An ABSENT `writeScope` is what the daemon refuses at 400, and it means a
  // lock over the whole working directory rather than nothing at all. So the
  // assertion is the key's presence, never its truthiness.
  it('should carry an own writeScope on a first open and on a re-open alike', async function () {
    const app = harness([
      () => live('s-1'),
      () => gone({error: 'evicted', reason: 'evicted', resumeSessionId: 's-2'}),
      () => live('s-3', 's-2'),
      () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
    ]);

    await app.send('Tighten this');

    const opens = app.calls.filter(function (call) {
      return call.path === '/sessions' && call.method === 'POST';
    });
    expect(opens).toHaveLength(2);
    opens.forEach(function (call) {
      expect(call.body?.payload !== undefined && 'writeScope' in call.body.payload).toBe(true);
      expect(call.body?.payload?.writeScope).toEqual([]);
    });
  });

  it('should run as an explorer with inklings own persona and toryos extras off', async function () {
    const app = harness([
      () => live('s-1'),
      () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
    ]);

    await app.send('Tighten this');

    const payload = app.calls[0]?.body?.payload ?? {};
    expect(payload.agent).toMatchObject({orientation: 'explorer'});
    expect(payload).toMatchObject({
      attachBrainMcp: false,
      autoPopulateMemory: false,
      captureFollowups: false,
      progressHeartbeat: false,
    });
    expect(payload.project).toEqual({name: 'vault', workingDir: VAULT});
    expect('id' in (payload.project as Record<string, unknown>)).toBe(false);
  });
});

describe('a session stored from an earlier run', function () {
  // A session id outlives the process that answered to it. Using a stored one
  // against a daemon that has restarted would fail the turn on what is really a
  // cold start.
  it('should check a stored session and open a new one when it is not live', async function () {
    const stale: Conversation = {...CONVERSATION, sessionId: 's-old'};
    const app = harness(
      [
        () => Response.json({sessionId: 's-old', state: 'closed', resumeSessionId: null, turns: 3}),
        () => live('s-new'),
        () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
      ],
      {conversation: stale},
    );

    const reply = await app.send('Tighten this');

    expect(app.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /sessions/s-old',
      'POST /sessions',
      'GET /sessions/s-new/events',
    ]);
    expect(reply).toBe('ok');
  });

  it('should keep talking to a stored session the daemon still calls live', async function () {
    const warm: Conversation = {...CONVERSATION, sessionId: 's-old'};
    const app = harness(
      [
        () => live('s-old'),
        () => stream(HELLO, said('ok'), ended({index: 0, isError: false})),
        () =>
          Response.json(
            {sessionId: 's-old', state: 'live', resumeSessionId: null, turns: 1},
            {status: 202},
          ),
      ],
      {conversation: warm},
    );

    const reply = await app.send('Tighten this');

    expect(app.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /sessions/s-old',
      'GET /sessions/s-old/events',
      'POST /sessions/s-old/messages',
    ]);
    expect(reply).toBe('ok');
  });
});

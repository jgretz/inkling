import {describe, expect, it} from 'bun:test';
import {
  createHeldSessionClient,
  HeldStreamError,
  toSessionError,
  toStreamFrame,
  type HeldSessionStatus,
} from '../src/held.ts';
import {DAEMON_TOKEN_HEADER} from '../src/wire.ts';

/** A live session, as the daemon reports one. */
const LIVE: HeldSessionStatus = {
  sessionId: 's-1',
  state: 'live',
  resumeSessionId: null,
  turns: 1,
};

/** A `fetch` that answers every request the same way. */
function always(response: () => Response): typeof fetch {
  return function () {
    return Promise.resolve(response());
  } as unknown as typeof fetch;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function sse(text: string, status = 200): Response {
  if (status !== 200) return new Response(text, {status});
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    {status, headers: {'content-type': 'text/event-stream'}},
  );
}

function client(fetchImpl: typeof fetch, token?: string | (() => string | Promise<string>)) {
  return createHeldSessionClient({
    endpoint: 'http://daemon.test',
    fetch: fetchImpl,
    ...(token === undefined ? {} : {token}),
  });
}

describe('openSession', function () {
  it('should return the session when the daemon answers 200', async function () {
    const result = await client(always(() => json(LIVE, 200))).openSession({
      caller: 'inkling',
      payload: {},
    });

    expect(result).toEqual({ok: true, value: LIVE});
  });

  it('should refuse a 200 body that is not a session status', async function () {
    const result = await client(always(() => json({sessionId: 's-1'}, 200))).openSession({
      caller: 'inkling',
      payload: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('does not recognise');
  });

  it('should report the daemon as unreachable when fetch rejects', async function () {
    const rejecting = function () {
      return Promise.reject(new Error('connection refused'));
    } as unknown as typeof fetch;

    const result = await client(rejecting).openSession({caller: 'inkling', payload: {}});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({
      status: 0,
      message: 'the toryo daemon is unreachable: connection refused',
    });
  });

  it('should resolve the token thunk once per request rather than once per client', async function () {
    const presented: Array<string | null> = [];
    let value = 'first';
    const recording = function (_url: unknown, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      presented.push(headers.get(DAEMON_TOKEN_HEADER));
      return Promise.resolve(json(LIVE, 200));
    } as unknown as typeof fetch;
    const held = client(recording, function () {
      return value;
    });

    await held.openSession({caller: 'inkling', payload: {}});
    value = 'second';
    await held.openSession({caller: 'inkling', payload: {}});

    expect(presented).toEqual(['first', 'second']);
  });
});

describe('postMessage', function () {
  it('should treat 202 as the accepted status rather than 200', async function () {
    const result = await client(always(() => json(LIVE, 202))).postMessage('s-1', 'hello');

    expect(result).toEqual({ok: true, value: LIVE});
  });
});

describe('toSessionError', function () {
  it('should carry the reason and the resume id of an eviction', function () {
    const error = toSessionError(410, {
      error: 'this session was evicted',
      reason: 'evicted',
      resumeSessionId: 's-2',
    });

    expect(error).toEqual({
      status: 410,
      message: 'this session was evicted',
      reason: 'evicted',
      resumeSessionId: 's-2',
    });
  });

  it('should carry the tail and the exit code of a crash', function () {
    const error = toSessionError(410, {
      error: 'this session crashed',
      reason: 'crashed',
      exitCode: 1,
      tail: 'panic: out of memory',
    });

    expect(error.reason).toBe('crashed');
    expect(error.tail).toBe('panic: out of memory');
    expect(error.exitCode).toBe(1);
  });

  it('should carry the reason of a closed session', function () {
    const error = toSessionError(410, {error: 'this session is closed', reason: 'closed'});

    expect(error.reason).toBe('closed');
  });

  // A `reason` of the wrong type must not reach a caller's switch: it would
  // pick a branch on a value the daemon never meant.
  it('should drop a reason that is not one of the three words', function () {
    const error = toSessionError(410, {error: 'gone', reason: 7});

    expect(error.reason).toBeUndefined();
  });

  it('should degrade to the status when the body is not JSON at all', function () {
    const error = toSessionError(502, null);

    expect(error).toEqual({status: 502, message: 'HTTP 502'});
  });
});

describe('toStreamFrame', function () {
  it('should map an assistant message event', function () {
    const frame = toStreamFrame({
      event: 'event',
      data: {event: {type: 'message', role: 'assistant', text: 'hi'}},
    });

    expect(frame).toEqual({kind: 'event', event: {type: 'message', role: 'assistant', text: 'hi'}});
  });

  it('should map a completed turn', function () {
    const frame = toStreamFrame({
      event: 'turn',
      data: {turn: {index: 0, isError: false, finalText: 'done'}},
    });

    expect(frame).toEqual({kind: 'turn', turn: {index: 0, isError: false, finalText: 'done'}});
  });

  // A reply is rendered against the turn it belongs to, so an unnumbered turn
  // would attach one to the wrong message.
  it('should drop a turn that carries no index', function () {
    const frame = toStreamFrame({event: 'turn', data: {turn: {isError: false}}});

    expect(frame).toBeNull();
  });

  it('should drop an event it has no case for', function () {
    expect(toStreamFrame({event: 'ping', data: {}})).toBeNull();
  });
});

describe('sessionEvents', function () {
  it('should yield the frames the daemon streamed', async function () {
    const body =
      'event: hello\ndata: {"sessionId":"s-1"}\n\n' +
      ': heartbeat\n\n' +
      'event: event\ndata: {"event":{"type":"message","role":"assistant","text":"hi"}}\n\n' +
      'event: turn\ndata: {"turn":{"index":0,"isError":false}}\n\n';
    const frames = [];

    for await (const frame of client(always(() => sse(body))).sessionEvents('s-1')) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      {kind: 'hello', sessionId: 's-1'},
      {kind: 'event', event: {type: 'message', role: 'assistant', text: 'hi'}},
      {kind: 'turn', turn: {index: 0, isError: false}},
    ]);
  });

  it('should throw an eviction a caller can branch on when the stream is refused', async function () {
    const gone = JSON.stringify({
      error: 'this session was evicted',
      reason: 'evicted',
      resumeSessionId: 's-2',
    });
    let caught: unknown;

    try {
      for await (const _frame of client(always(() => sse(gone, 410))).sessionEvents('s-1')) {
        throw new Error('should not have yielded a frame');
      }
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HeldStreamError);
    expect((caught as HeldStreamError).error).toEqual({
      status: 410,
      message: 'this session was evicted',
      reason: 'evicted',
      resumeSessionId: 's-2',
    });
  });

  it('should degrade to the status when the refusal body is not JSON', async function () {
    let caught: unknown;

    try {
      for await (const _frame of client(
        always(() => sse('<html>bad gateway</html>', 502)),
      ).sessionEvents('s-1')) {
        throw new Error('should not have yielded a frame');
      }
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HeldStreamError);
    expect((caught as HeldStreamError).error).toEqual({status: 502, message: 'HTTP 502'});
  });
});

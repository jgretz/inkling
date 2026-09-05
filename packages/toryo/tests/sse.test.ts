import {describe, expect, it} from 'bun:test';
import {sseFrames, SseConnectError, type SseFrame} from '../src/sse.ts';

/**
 * A response whose body arrives in the chunks given, so a frame split across two
 * network reads is exercised rather than assumed.
 */
function streaming(chunks: readonly string[], status = 200): Response {
  if (status !== 200) return new Response(chunks.join(''), {status});
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach(function (chunk) {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      },
    }),
    {status, headers: {'content-type': 'text/event-stream'}},
  );
}

function serving(response: Response): typeof fetch {
  return function () {
    return Promise.resolve(response);
  } as unknown as typeof fetch;
}

async function read(response: Response, headers?: Record<string, string>): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of sseFrames({
    endpoint: 'http://daemon.test',
    path: '/sessions/s-1/events',
    fetch: serving(response),
    ...(headers === undefined ? {} : {headers}),
  })) {
    frames.push(frame);
  }
  return frames;
}

describe('sseFrames', function () {
  it('should join a frame split across two network reads', async function () {
    const frames = await read(streaming(['event: hello\ndata: {"session', 'Id":"s-1"}\n\n']));

    expect(frames).toEqual([{event: 'hello', data: {sessionId: 's-1'}}]);
  });

  it('should concatenate multiple data lines before parsing them as one value', async function () {
    const frames = await read(streaming(['event: note\ndata: {"sessionId":\ndata: "s-1"}\n\n']));

    expect(frames).toEqual([{event: 'note', data: {sessionId: 's-1'}}]);
  });

  it('should keep an id when the daemon numbered the frame', async function () {
    const frames = await read(streaming(['id: 4\nevent: note\ndata: 1\n\n']));

    expect(frames).toEqual([{event: 'note', id: 4, data: 1}]);
  });

  it('should drop a heartbeat comment and a frame whose data will not parse', async function () {
    const frames = await read(
      streaming([': keep-alive\n\n', 'event: note\ndata: {oops\n\n', 'event: note\ndata: 1\n\n']),
    );

    expect(frames).toEqual([{event: 'note', data: 1}]);
  });

  it('should drop a block that names no event', async function () {
    const frames = await read(streaming(['data: 1\n\n']));

    expect(frames).toEqual([]);
  });

  // The connect failure is what a caller branches on, so the status and the body
  // travel with it rather than only in the message.
  it('should throw the daemon status and body when the stream is refused', async function () {
    let caught: unknown;

    try {
      await read(streaming(['{"error":"gone"}'], 410));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SseConnectError);
    expect((caught as SseConnectError).status).toBe(410);
    expect((caught as SseConnectError).body).toBe('{"error":"gone"}');
  });

  it('should send the caller headers but never let one clobber accept', async function () {
    let sent: Headers | undefined;
    const recording = function (_url: unknown, init?: RequestInit) {
      sent = new Headers(init?.headers);
      return Promise.resolve(streaming(['event: note\ndata: 1\n\n']));
    } as unknown as typeof fetch;

    for await (const _frame of sseFrames({
      endpoint: 'http://daemon.test',
      path: '/sessions/s-1/events',
      headers: {'x-token': 'abc', accept: 'application/json'},
      fetch: recording,
    })) {
      break;
    }

    expect(sent?.get('x-token')).toBe('abc');
    expect(sent?.get('accept')).toBe('text/event-stream');
  });
});

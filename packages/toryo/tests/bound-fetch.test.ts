import {describe, expect, it} from 'bun:test';
import {createHeldSessionClient} from '../src/index.ts';
import {boundFetch, sseFrames} from '../src/sse.ts';

/**
 * The receiver rule, which only WebKit enforces.
 *
 * `fetch` pulled off the window and called without a receiver throws
 * `Can only call Window.fetch on instances of Window` in Safari's engine, and
 * so does calling it as a property of an ordinary object. Chrome, bun and
 * happy-dom all allow both, so a bare reference passes every test in this repo
 * and fails on the first request the Tauri webview makes.
 *
 * `strictFetch` below is that rule, written down. It is the only thing standing
 * between this package and shipping the same bug again, because no runtime the
 * suite can run in will catch it.
 */

/** A `fetch` that refuses the wrong receiver, the way WebKit's does. */
function strictFetch(): typeof fetch & {calls: number} {
  function impl(this: unknown): Promise<Response> {
    // A plain call in a module is `undefined`; a property call is the holder.
    // Only the window itself is allowed, which is the rule being reproduced.
    if (this !== globalThis) {
      throw new TypeError('Can only call Window.fetch on instances of Window');
    }
    impl.calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          sessionId: 's1',
          state: 'live',
          caller: 'inkling',
          workingDir: '/vault',
          writeScope: [],
          resumeSessionId: null,
          turns: 0,
          openedAt: '2026-09-05T00:00:00.000Z',
          lastActivityAt: '2026-09-05T00:00:00.000Z',
          exitCode: null,
        }),
        {
          status: 200,
          headers: {'content-type': 'application/json'},
        },
      ),
    );
  }
  impl.calls = 0;
  return impl as unknown as typeof fetch & {calls: number};
}

describe('boundFetch', function () {
  it('should survive being called with no receiver at all', function () {
    const strict = strictFetch();

    const bound = boundFetch(strict);

    expect(function () {
      void bound('http://127.0.0.1:9790/healthz');
    }).not.toThrow();
  });

  it('should survive being called as a property of an ordinary object', function () {
    // This is the shape `sseFrames` used to have: `options.fetch(...)`, whose
    // receiver is the options object rather than a window.
    const holder = {fetch: boundFetch(strictFetch())};

    expect(function () {
      void holder.fetch('http://127.0.0.1:9790/healthz');
    }).not.toThrow();
  });

  it('should still forward to the function it was given', async function () {
    const strict = strictFetch();

    await boundFetch(strict)('http://127.0.0.1:9790/healthz');

    expect(strict.calls).toBe(1);
  });
});

describe('the held client under WebKit rules', function () {
  it('should open a session with a fetch that refuses a bad receiver', async function () {
    const client = createHeldSessionClient({token: 'tok', fetch: strictFetch()});

    const opened = await client.openSession({caller: 'inkling', payload: {prompt: 'hi'}});

    expect(opened.ok).toBe(true);
  });
});

describe('sseFrames under WebKit rules', function () {
  it('should not call its fetch as a property of its options', async function () {
    const strict = strictFetch();
    const frames = sseFrames({
      endpoint: 'http://127.0.0.1:9790',
      path: '/sessions/s1/events',
      fetch: strict,
    });

    // The connect throws for want of a stream body, not for the receiver, which
    // is the distinction under test.
    let message = '';
    try {
      await frames.next();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain('instances of Window');
  });
});

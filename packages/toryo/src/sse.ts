/**
 * The Server-Sent-Events frame reader.
 *
 * Copied from toryo's `packages/cli-process/src/sse-frames.ts`, with one
 * change: the `fetch` is injected rather than reached for off the global. That
 * is what lets every test in this repository drive a session end to end with no
 * daemon running and no global patching, which the original cannot do, since
 * `DispatchHttpOptions.fetch` never reaches its stream.
 *
 * Zero imports, `node:` builtins included. It uses `fetch`, `URL` and
 * `TextDecoder` and nothing else, which is what makes it safe in the webview
 * bundle.
 */

/**
 * One raw frame. `data` is `JSON.parse`d once; `held.ts` narrows it into a
 * discriminated union.
 */
export type SseFrame = {
  event: string;
  id?: number;
  data: unknown;
};

export type SseFramesOptions = {
  /** SSE endpoint base URL, e.g. `http://127.0.0.1:9790`. */
  endpoint: string;
  /** Relative path to the events route. */
  path: string;
  /**
   * Extra request headers, for an endpoint that wants a credential. Prefer this
   * over a query parameter for a secret: the URL is interpolated into the
   * connect-failure message below, and a header is not.
   *
   * `accept` is not overridable; the parser depends on it.
   */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** How the request is made. Injected by tests; there is no default. */
  fetch: typeof fetch;
};

/**
 * Every frame off an SSE endpoint, one per `\n\n`-delimited block. `data` is the
 * `JSON.parse` of the (per-spec `\n`-concatenated) `data:` field.
 *
 * Heartbeat comment lines (`:`-prefixed) and malformed frames (no `event:` line,
 * or a `JSON.parse` failure) are dropped silently.
 *
 * **Connect-failure contract**: throws on a non-OK response or a missing body.
 * A caller wanting a value instead of a throw has to wrap it, which is what
 * `dispatch-transport.ts` does so it can read a 410's body.
 */
/**
 * A `fetch` that survives being called as a plain function.
 *
 * WebKit enforces the receiver. `fetch` pulled off the window and called
 * without one throws `Can only call Window.fetch on instances of Window`, and
 * so does calling it as a property of anything that is not a window, which
 * `options.fetch(...)` is. Chrome, bun and happy-dom all allow both, so this
 * fails **only** in the Tauri webview and passes every test and every
 * Node-side check on the way there.
 *
 * Binding an injected fake is harmless: it still forwards to the fake, so a
 * test's assertions on it are unaffected.
 */
export function boundFetch(candidate?: typeof fetch): typeof fetch {
  return (candidate ?? globalThis.fetch).bind(globalThis);
}

export async function* sseFrames(options: SseFramesOptions): AsyncGenerator<SseFrame> {
  const url = new URL(options.path, options.endpoint);

  const response = await boundFetch(options.fetch)(url, {
    signal: options.signal ?? null,
    // `accept` last, so a caller cannot clobber the content type this parser
    // depends on while still getting its own headers through.
    headers: {...options.headers, accept: 'text/event-stream'},
  });
  if (!response.ok || !response.body) {
    throw new SseConnectError(response.status, await bodyText(response), url.toString());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, {stream: true});
      // SSE frames are separated by blank lines.
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = parseFrame(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        if (frame) yield frame;
        separator = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed, which is the ordinary end of a stream.
    }
  }
}

/**
 * A stream that never opened, carrying the daemon's own status and body.
 *
 * An `Error` subclass rather than a plain throw because the caller branches on
 * it: a 410 on this route is an eviction with a `resumeSessionId` in the body,
 * and a 401 is a token to re-read. The original throws a bare `Error` whose
 * message is the only thing carried, which leaves a caller regexing prose for
 * a decision.
 */
export class SseConnectError extends Error {
  readonly status: number;
  /** The response body as text, unparsed. Empty when there was none to read. */
  readonly body: string;

  constructor(status: number, body: string, url: string) {
    super(`the session stream failed: HTTP ${status} from ${url}`);
    this.name = 'SseConnectError';
    this.status = status;
    this.body = body;
  }
}

async function bodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Parse a single frame block. Per the spec, multiple `data:` lines are
 * concatenated with `\n` (a single leading space after the colon is stripped);
 * the last `event:` and `id:` win.
 */
function parseFrame(block: string): SseFrame | null {
  let event: string | null = null;
  let id: number | undefined;
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue; // comment or heartbeat
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('id:')) {
      const parsed = Number(line.slice(3).trim());
      if (Number.isFinite(parsed)) id = parsed;
    }
  }

  if (!event || dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join('\n')) as unknown;
    return id === undefined ? {event, data} : {event, id, data};
  } catch {
    return null;
  }
}

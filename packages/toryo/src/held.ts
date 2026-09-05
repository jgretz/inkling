import {sseFrames, SseConnectError, type SseFrame} from './sse.ts';
import {DAEMON_ENDPOINT, DAEMON_TOKEN_HEADER} from './wire.ts';

/**
 * The held-session half of toryo's dispatch daemon, over `fetch` and nothing
 * else.
 *
 * ## Why this is a copy rather than an import
 *
 * toryo serves exactly this at `@toryo/dispatch-client/http`, and inkling cannot
 * import it: every package under toryo's `packages/` is `"private": true` at
 * version `0.0.0` with `workspace:*` dependencies, so `bun install` against a
 * `file:` reference to it resolves nothing. See `wire.ts` for what that costs.
 *
 * It is not the whole of that module. inkling drives one plane, so this carries
 * the five held-session methods, the 410 mapping and the frame reader, and none
 * of the job plane, none of the guards that serve it, and none of
 * `@toryo/result`: a failure is a value here, `{ok: true, value}` or
 * `{ok: false, error}`. Zero dependencies is what makes "no `node:` import
 * reaches the webview bundle" a structural fact rather than a rule to remember.
 *
 * ## Frames are checked, not cast
 *
 * The daemon is a separately-versioned binary, so a body of the wrong shape
 * arrives here looking fine. Everything a caller branches on goes through a
 * predicate first, and anything unrecognised is dropped or degraded to the
 * status and the message rather than read through a cast.
 */

/** Where a session ended up, as the daemon reports it. */
export type HeldSessionState = 'live' | 'evicted' | 'crashed' | 'closed';

/**
 * The body `POST /sessions`, `GET /sessions/:id` and `POST .../close` return.
 *
 * Only the four fields a caller decides on are required, because those are the
 * four [`isHeldSessionStatus`] checks. The rest are rendered rather than
 * branched on, so they are optional here: declaring them required would be a
 * claim the guard does not make, and the first field dispatch adds or drops
 * would make it a false one.
 */
export type HeldSessionStatus = {
  sessionId: string;
  state: HeldSessionState;
  /** Set when this session resumed another, so a re-open can chain again. */
  resumeSessionId: string | null;
  /** How many turns the conversation has taken, so far. */
  turns: number;
  caller?: string;
  workingDir?: string;
  writeScope?: string[];
  openedAt?: string;
  lastActivityAt?: string;
  exitCode?: number | null;
};

/**
 * A refusal, with the daemon's status attached so a caller branches without
 * re-deriving it from the message.
 *
 * `reason` and `resumeSessionId` are present on a 410 and are the whole point of
 * the eviction design: the caller is told to re-open, and the id is what makes
 * the re-open a resume rather than a cold start.
 */
export type HeldSessionError = {
  /** The HTTP status, or 0 when the request never reached a daemon at all. */
  status: number;
  message: string;
  reason?: 'evicted' | 'crashed' | 'closed';
  resumeSessionId?: string | null;
  exitCode?: number | null;
  /** The last of the session's output, on a crash. */
  tail?: string;
};

/** A completed turn, as far as a client branches on it. */
export type HeldStreamTurn = {
  index: number;
  finalText?: string;
  isError: boolean;
  [field: string]: unknown;
};

/** One frame off a session's event stream. */
export type HeldStreamFrame =
  | {kind: 'hello'; sessionId: string}
  | {kind: 'event'; event: unknown}
  | {kind: 'turn'; turn: HeldStreamTurn}
  | {kind: 'closed'; result: unknown}
  | {kind: 'error'; message: string};

/** A failure as a value, so no caller has to wrap a call in a `try`. */
export type HeldResult<T> = {ok: true; value: T} | {ok: false; error: HeldSessionError};

/**
 * A stream that never opened, carrying the daemon's refusal in the same shape
 * every other method returns one.
 *
 * A throw rather than a returned value because [`HeldSessionClient.sessionEvents`]
 * is a generator: a connect failure happens before the first frame, and a caller
 * driving it with `for await` has nowhere to read a result from. The typed
 * `error` is what keeps the caller's `switch` off the message text.
 */
export class HeldStreamError extends Error {
  readonly error: HeldSessionError;

  constructor(error: HeldSessionError) {
    super(error.message);
    this.name = 'HeldStreamError';
    this.error = error;
  }
}

export type HeldSessionOptions = {
  /** The daemon's base URL. Defaults to {@link DAEMON_ENDPOINT}. */
  endpoint?: string;
  /**
   * The host daemon token, or a thunk resolving it. Omitted, every call is
   * refused with a 401.
   *
   * A thunk is resolved once per REQUEST rather than once per client, mirroring
   * the daemon's own per-request read, so a token that changed on disk takes
   * effect without the client being rebuilt.
   */
  token?: string | (() => string | Promise<string>);
  /** How requests are made. Injected by tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

export type HeldSessionClient = {
  /** Open a held session. The payload's `writeScope` is required by the daemon. */
  openSession(args: {caller: string; payload: unknown}): Promise<HeldResult<HeldSessionStatus>>;
  /** Push a further message. Resolves once the daemon accepted it. */
  postMessage(sessionId: string, text: string): Promise<HeldResult<HeldSessionStatus>>;
  /** The session's live frames. Throws {@link HeldStreamError} on a connect failure. */
  sessionEvents(
    sessionId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<HeldStreamFrame, void, void>;
  /** What happened to a session, including one that already ended. */
  getSession(sessionId: string): Promise<HeldResult<HeldSessionStatus>>;
  /** End a session and reap its process. */
  closeSession(sessionId: string): Promise<HeldResult<HeldSessionStatus>>;
};

export function createHeldSessionClient(options: HeldSessionOptions = {}): HeldSessionClient {
  const endpoint = options.endpoint ?? DAEMON_ENDPOINT;
  const doFetch = options.fetch ?? fetch;

  async function tokenHeader(): Promise<Record<string, string>> {
    const {token} = options;
    if (token === undefined) return {};
    const value = typeof token === 'function' ? await token() : token;
    return value ? {[DAEMON_TOKEN_HEADER]: value} : {};
  }

  /** One call, mapped onto {@link HeldSessionError} whatever went wrong. */
  async function call(
    path: string,
    init: {method: 'GET' | 'POST'; body?: unknown},
    expected: number,
  ): Promise<HeldResult<HeldSessionStatus>> {
    let response: Response;
    try {
      response = await doFetch(new URL(path, endpoint), {
        method: init.method,
        headers: {'content-type': 'application/json', ...(await tokenHeader())},
        ...(init.body === undefined ? {} : {body: JSON.stringify(init.body)}),
      });
    } catch (error) {
      return {
        ok: false,
        error: {status: 0, message: `the toryo daemon is unreachable: ${why(error)}`},
      };
    }

    const raw = await readJson(response);
    if (response.status !== expected)
      return {ok: false, error: toSessionError(response.status, raw)};
    if (!isHeldSessionStatus(raw)) {
      return {
        ok: false,
        error: {
          status: response.status,
          message: `the toryo daemon answered ${path} with a session status this build does not recognise`,
        },
      };
    }
    return {ok: true, value: raw};
  }

  return {
    openSession(args) {
      return call('/sessions', {method: 'POST', body: args}, 200);
    },

    postMessage(sessionId, text) {
      // 202, not 200: the daemon took the message onto the session's stdin and
      // the reply arrives on the event stream.
      return call(
        `/sessions/${encodeURIComponent(sessionId)}/messages`,
        {method: 'POST', body: {text}},
        202,
      );
    },

    getSession(sessionId) {
      return call(`/sessions/${encodeURIComponent(sessionId)}`, {method: 'GET'}, 200);
    },

    closeSession(sessionId) {
      return call(`/sessions/${encodeURIComponent(sessionId)}/close`, {method: 'POST'}, 200);
    },

    async *sessionEvents(sessionId, signal) {
      const frames = sseFrames({
        endpoint,
        path: `/sessions/${encodeURIComponent(sessionId)}/events`,
        // The header rather than the `?token=` the daemon also accepts: the
        // connect-failure message interpolates the URL, so a token in the query
        // would land in every 401 the app logs.
        headers: await tokenHeader(),
        ...(signal ? {signal} : {}),
        fetch: doFetch,
      });

      try {
        for await (const frame of frames) {
          const mapped = toStreamFrame(frame);
          if (mapped) yield mapped;
        }
      } catch (error) {
        if (error instanceof SseConnectError) {
          throw new HeldStreamError(toSessionError(error.status, parseBody(error.body)));
        }
        throw error;
      }
    },
  };
}

/**
 * A session status, checked at the four fields a caller decides on: which
 * session this is, whether it is live or over, what a re-open passes, and
 * whether the conversation has said anything yet.
 *
 * The timing and scope fields are rendered rather than branched on, so they are
 * deliberately unchecked: requiring the whole row would reject the first field
 * dispatch adds, and that is the failure mode that gets guards deleted.
 */
export function isHeldSessionStatus(value: unknown): value is HeldSessionStatus {
  if (!isRecord(value)) return false;
  if (typeof value.sessionId !== 'string') return false;
  if (!isHeldSessionState(value.state)) return false;
  if (typeof value.turns !== 'number') return false;
  return typeof value.resumeSessionId === 'string' || value.resumeSessionId === null;
}

function isHeldSessionState(value: unknown): value is HeldSessionState {
  return value === 'live' || value === 'evicted' || value === 'crashed' || value === 'closed';
}

/**
 * A non-expected status rendered as an error a caller can branch on.
 *
 * `reason` and `resumeSessionId` are lifted out ONLY when they carry the shapes
 * the caller acts on, so a body whose `reason` is a number cannot reach a
 * `switch` that assumes a string. Anything unrecognised degrades to the status
 * and the message, which still says that something went wrong.
 */
export function toSessionError(status: number, body: unknown): HeldSessionError {
  const message = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${status}`;
  const error: HeldSessionError = {status, message};
  if (!isRecord(body)) return error;
  if (body.reason === 'evicted' || body.reason === 'crashed' || body.reason === 'closed') {
    error.reason = body.reason;
  }
  if (typeof body.resumeSessionId === 'string' || body.resumeSessionId === null) {
    error.resumeSessionId = body.resumeSessionId;
  }
  if (typeof body.exitCode === 'number' || body.exitCode === null) error.exitCode = body.exitCode;
  if (typeof body.tail === 'string') error.tail = body.tail;
  return error;
}

/**
 * Map one raw frame to a typed one, or null to drop it.
 *
 * A `turn` with no `index` is DROPPED rather than yielded with a hole, because a
 * caller renders a reply against the turn it belongs to and an unnumbered turn
 * would attach a reply to the wrong message.
 */
export function toStreamFrame(frame: SseFrame): HeldStreamFrame | null {
  const data = frame.data;
  switch (frame.event) {
    case 'hello':
      return isRecord(data) && typeof data.sessionId === 'string'
        ? {kind: 'hello', sessionId: data.sessionId}
        : null;
    case 'event':
      return isRecord(data) && 'event' in data ? {kind: 'event', event: data.event} : null;
    case 'turn': {
      if (!isRecord(data) || !isRecord(data.turn)) return null;
      const turn = data.turn;
      if (typeof turn.index !== 'number' || typeof turn.isError !== 'boolean') return null;
      return {kind: 'turn', turn: turn as unknown as HeldStreamTurn};
    }
    case 'closed':
      return isRecord(data) && isRecord(data.result) ? {kind: 'closed', result: data.result} : null;
    case 'error':
      return isRecord(data) && typeof data.message === 'string'
        ? {kind: 'error', message: data.message}
        : null;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed body, or null for one that was never JSON at all. */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Why a `fetch` rejected, as text.
 *
 * A `catch` binding is `unknown`, and `fetch` is not the only thing that can
 * reject here: an injected transport, or an abort handler, may throw a string or
 * a `DOMException`. Reading `.message` off a cast would render those as
 * `undefined` and lose the one detail the caller had.
 */
function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

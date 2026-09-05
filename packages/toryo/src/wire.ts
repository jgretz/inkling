/**
 * The two literals every call in this package is addressed with.
 *
 * Both are copies. `DAEMON_TOKEN_HEADER` mirrors the constant of the same name
 * in toryo's `packages/config/src/daemon-token-wire.ts`, and `DAEMON_ENDPOINT`
 * mirrors what `daemonEndpoint('dispatch')` in `packages/config/src/daemon-http.ts`
 * builds from its fallback port, 9790.
 *
 * The duplication is load-bearing rather than lazy: nothing in toryo's
 * `packages/` is published, every one of them is `"private": true` with
 * `workspace:*` dependencies, so a different repository cannot depend on the
 * module that owns these names. Copying them is the only way inkling reaches
 * that daemon at all.
 *
 * What breaks silently if either end changes: a renamed header means every
 * request is answered 401 and the writer is told their token is missing, which
 * is the wrong diagnosis; a moved port means every request fails to connect and
 * the writer is told the daemon is down, which is also wrong. Neither shows up
 * in a typecheck or a test on either side. If `@toryo/dispatch-client` is ever
 * published, this whole package collapses into a dependency on it and these two
 * lines go with it.
 */

/** The header the daemon token travels in. Mirrors `DAEMON_TOKEN_HEADER`. */
export const DAEMON_TOKEN_HEADER = 'x-toryo-daemon-token';

/**
 * The dispatch daemon's base URL.
 *
 * A constant rather than a setting, deliberately: a machine whose daemon moved
 * needs a settings key and a way to edit it, and that is its own small task.
 * toryo reads `TORYO_DISPATCH_HTTP_PORT` where there is an environment, and a
 * webview has no `process`, so the fallback port is what a browser consumer
 * would resolve to anyway.
 */
export const DAEMON_ENDPOINT = 'http://127.0.0.1:9790';

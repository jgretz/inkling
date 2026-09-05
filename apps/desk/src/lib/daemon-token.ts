import {homeDir, join} from '@tauri-apps/api/path';
import {readTextFile} from '@tauri-apps/plugin-fs';

/**
 * The token inkling presents to toryo's dispatch daemon.
 *
 * The daemon mints it into `$HOME/.toryo/daemon-token` when the file is absent
 * or blank, and reads it back per request. Nothing rotates it, so there are
 * exactly two ways a request can be refused with a 401 and they want opposite
 * handling: the file changed underneath a long-lived window, which one re-read
 * fixes, or there is no file at all, in which case every request from now until
 * the daemon is restarted will be refused and retrying is just a slower failure.
 * {@link TokenState} is what tells those two apart.
 *
 * ## Why the path is pinned rather than derived
 *
 * A Tauri capability is static JSON baked into the binary and cannot follow an
 * environment variable, so the grant in `src-tauri/capabilities/default.json`
 * names `$HOME/.toryo/daemon-token` literally. `TORYO_HOME` is deliberately not
 * consulted here: a read that followed it would be refused by the capability
 * anyway, and silently, which is the worst of both.
 *
 * ## Why the Tauri calls are injected rather than imported at the call site
 *
 * A `mock.module` on `@tauri-apps/*` registers in bun's global mock registry and
 * contaminates every other suite in the run, per `docs/testing.md`. So the three
 * calls this module makes are a value a test can replace.
 */

/** The leaf under the toryo home. Mirrors `daemonTokenPath()` in `@toryo/config`. */
const TOKEN_FILE = 'daemon-token';

const TOKEN_DIR = '.toryo';

/** Whether a token exists to present at all. */
export type TokenState = 'present' | 'missing';

/** What a re-read learned: the state now, and whether it moved. */
export type TokenRefresh = {
  state: TokenState;
  /** True when the value on disk differs from the one the caller last used. */
  changed: boolean;
};

/**
 * Everything outside this module the read touches, so a test can drive it with
 * no webview. See the module note for why this is not `mock.module`.
 */
export type TokenPrimitives = {
  homeDir: () => Promise<string>;
  join: (...parts: string[]) => Promise<string>;
  readTextFile: (path: string) => Promise<string>;
};

/** The window's primitives: the real Tauri APIs behind the injectable surface. */
const tauriPrimitives: TokenPrimitives = {homeDir, join, readTextFile};

/**
 * Resolved once by {@link initDaemonToken}, then read synchronously.
 *
 * Synchronous because the client's token thunk is called per request and a
 * `Promise` there would make every request wait on an IPC round trip to the
 * filesystem, for a value that changes approximately never.
 */
let cached: string | null = null;

/**
 * How the read reaches disk. Module state rather than a parameter because the
 * caller of {@link refreshDaemonToken} is a transport handling a 401, which has
 * nothing to thread primitives through.
 */
let primitives: TokenPrimitives = tauriPrimitives;

/**
 * Read the token file into the cache. Call once, before the first turn.
 *
 * Never throws. A missing file, an unreadable one, or running outside Tauri at
 * all (a unit test, `bun run web`) all cache null, which means inkling presents
 * no token and the daemon refuses every call. That is the honest outcome: there
 * is no ungated connection to fall back to.
 *
 * It does not call `exists()` first, so it needs no third capability grant: a
 * missing file rejects inside `readTextFile` and lands in the same catch.
 *
 * `over` replaces the primitives every later read in this module uses, and is
 * for tests alone. The app calls this with no argument.
 */
export async function initDaemonToken(over?: TokenPrimitives): Promise<void> {
  if (over) primitives = over;
  cached = await readToken();
}

/** The cached token, or null when there is none to present. */
export function daemonToken(): string | null {
  return cached;
}

/** Whether there is a token at all, as of the last read. */
export function daemonTokenState(): TokenState {
  return cached === null ? 'missing' : 'present';
}

/**
 * Re-read the file, reporting the state now and whether it differs from `seen`,
 * the value the caller's refused request carried.
 *
 * The comparison is against the caller's own `seen` rather than against the
 * cache, so two turns refused by the same 401 both learn the truth: comparing
 * against the cache would let whichever call resolved first claim the change and
 * leave the other reading its own freshly-written value as unchanged.
 *
 * It exists because the daemon mints the token in its own `start`, so on a fresh
 * machine the file does not exist when inkling launches. Without the refresh,
 * every turn would fail until inkling itself was restarted.
 */
export async function refreshDaemonToken(seen: string | null): Promise<TokenRefresh> {
  cached = await readToken();
  return {state: daemonTokenState(), changed: cached !== seen};
}

/**
 * Drop the cache and the injected primitives. Test-only: this module's state is
 * a singleton, so the first case to call {@link initDaemonToken} would otherwise
 * decide what every later one reads.
 */
export function resetDaemonToken(): void {
  cached = null;
  primitives = tauriPrimitives;
}

/** The trimmed file contents, or null. A blank file is null, matching the daemon. */
async function readToken(): Promise<string | null> {
  try {
    const home = await primitives.homeDir();
    const path = await primitives.join(home, TOKEN_DIR, TOKEN_FILE);
    const token = (await primitives.readTextFile(path)).trim();
    return token || null;
  } catch {
    // No file yet (no daemon has served HTTP), an unreadable one, or no Tauri
    // at all. All three mean the same thing to a caller: nothing to present.
    return null;
  }
}

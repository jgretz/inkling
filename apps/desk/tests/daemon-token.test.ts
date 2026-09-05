import {afterEach, describe, expect, it} from 'bun:test';
import {
  daemonToken,
  daemonTokenState,
  initDaemonToken,
  refreshDaemonToken,
  resetDaemonToken,
  type TokenPrimitives,
} from '../src/lib/daemon-token.ts';

/**
 * The token reader, driven through its injected primitives.
 *
 * Never `mock.module` on `@tauri-apps/*`: bun's mock registry is global to a
 * run, so one suite's mock would reach every other file that imports the same
 * module. That is why the three calls this module makes are a value.
 */

afterEach(resetDaemonToken);

/** A disk holding whatever the mapping says, and rejecting for anything else. */
function disk(files: Record<string, string>): TokenPrimitives {
  return {
    homeDir() {
      return Promise.resolve('/Users/writer');
    },
    join(...parts) {
      return Promise.resolve(parts.join('/'));
    },
    readTextFile(path) {
      const found = files[path];
      if (found === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(found);
    },
  };
}

const TOKEN_PATH = '/Users/writer/.toryo/daemon-token';

describe('initDaemonToken', function () {
  it('should read the token the daemon minted, trimmed', async function () {
    await initDaemonToken(disk({[TOKEN_PATH]: '  abc123\n'}));

    expect(daemonToken()).toBe('abc123');
    expect(daemonTokenState()).toBe('present');
  });

  // A missing file is the ordinary case on a machine whose daemon has never
  // served HTTP. There is no ungated connection to fall back to, so no token is
  // the honest answer rather than an error.
  it('should report no token when the file is not there', async function () {
    await initDaemonToken(disk({}));

    expect(daemonToken()).toBeNull();
    expect(daemonTokenState()).toBe('missing');
  });

  it('should treat a blank file as no token, the way the daemon does', async function () {
    await initDaemonToken(disk({[TOKEN_PATH]: '   \n'}));

    expect(daemonToken()).toBeNull();
  });

  it('should read it from the pinned path the capability grants', async function () {
    const read: string[] = [];
    const primitives = disk({[TOKEN_PATH]: 'abc123'});

    await initDaemonToken({
      ...primitives,
      readTextFile(path) {
        read.push(path);
        return primitives.readTextFile(path);
      },
    });

    expect(read).toEqual([TOKEN_PATH]);
  });
});

describe('refreshDaemonToken', function () {
  it('should report a change when the file now holds something else', async function () {
    const files: Record<string, string> = {[TOKEN_PATH]: 'old'};
    await initDaemonToken(disk(files));
    files[TOKEN_PATH] = 'new';

    const refreshed = await refreshDaemonToken('old');

    expect(refreshed).toEqual({state: 'present', changed: true});
    expect(daemonToken()).toBe('new');
  });

  // A daemon that is simply down refuses every request with the file untouched.
  // Answering "changed" there would have the transport retry forever.
  it('should report no change when the file is untouched', async function () {
    await initDaemonToken(disk({[TOKEN_PATH]: 'abc123'}));

    expect(await refreshDaemonToken('abc123')).toEqual({state: 'present', changed: false});
  });

  // Compared against what the refused request carried, not against the cache:
  // two turns refused by the same 401 both land here, and comparing against the
  // cache would let whichever resolved first claim the change.
  it('should answer each caller against the value that caller presented', async function () {
    const files: Record<string, string> = {[TOKEN_PATH]: 'old'};
    await initDaemonToken(disk(files));
    files[TOKEN_PATH] = 'new';

    const first = await refreshDaemonToken('old');
    const second = await refreshDaemonToken('old');

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(true);
  });

  it('should report the token missing once the file has gone', async function () {
    const files: Record<string, string> = {[TOKEN_PATH]: 'old'};
    await initDaemonToken(disk(files));
    delete files[TOKEN_PATH];

    expect(await refreshDaemonToken('old')).toEqual({state: 'missing', changed: true});
  });
});

describe('resetDaemonToken', function () {
  // This module is a singleton, so without it the first case to initialise would
  // decide what every later one reads.
  it('should drop the cached token', async function () {
    await initDaemonToken(disk({[TOKEN_PATH]: 'abc123'}));

    resetDaemonToken();

    expect(daemonToken()).toBeNull();
  });
});

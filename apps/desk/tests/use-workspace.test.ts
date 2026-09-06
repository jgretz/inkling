import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {act, renderHook} from '@testing-library/react';
import type {DocPath, GroupPath, VaultPath} from '@inkling/vault';
import {useWorkspace, type WorkspaceBridge} from '../src/lib/use-workspace.ts';

autoCleanup();

/**
 * The two writes an agent turn needs: the flush before it, and the landing
 * after it.
 *
 * The bridge is a value the hook takes rather than a module it imports, so a
 * whole vault is a `Map` here and nothing needs a webview. Never a
 * `mock.module` on `bridge.ts` instead: bun's mock registry is global to a run
 * and would reach every other file that imports it.
 */

const VAULT = '/Users/writer/vault' as VaultPath;
const DOC = 'a.md' as DocPath;
const GROUP = 'drafts' as GroupPath;
/** A second document, inside the group, for what a group delete takes with it. */
const NESTED = 'drafts/b.md' as DocPath;

/** A promise the test decides when to settle, for asserting on ordering. */
function gate(): {promise: Promise<void>; open: () => void} {
  let open = function () {};
  const promise = new Promise<void>(function (resolve) {
    open = resolve;
  });
  return {promise, open};
}

type Disk = {
  bridge: WorkspaceBridge;
  writes: string[];
  reads: number;
  /** Every path a delete was asked for, in the order the calls landed. */
  deleted: string[];
  /** What the vault holds now, so a test can ask whether a file came back. */
  files: Map<string, string>;
  /** Held open across one write, so a flush can be caught mid-flight. */
  hold: {promise: Promise<void>; open: () => void} | undefined;
};

/**
 * A vault holding one document at the root and one inside a group.
 *
 * The read adds a trailing newline the write did not carry, standing in for
 * every way a real filesystem can hand back something other than what it was
 * given. It is what makes "the buffer holds what was read" an assertion rather
 * than a coincidence.
 */
function disk(initial: string): Disk {
  const files = new Map<string, string>([
    [DOC, initial],
    [NESTED, '# b\n'],
  ]);
  const state: Disk = {
    writes: [],
    reads: 0,
    deleted: [],
    files,
    hold: undefined,
    bridge: {
      listDocs() {
        return Promise.resolve(
          [...files].map(function ([path, source]) {
            return {path, source, mtime: '1'};
          }),
        );
      },
      listGroups() {
        return Promise.resolve([GROUP]);
      },
      openVaultDb() {
        return Promise.resolve({kind: 'ready', schemaVersion: 1});
      },
      readDoc(_vault, path) {
        state.reads += 1;
        const stored = files.get(path) ?? '';
        return Promise.resolve({
          path,
          source: stored.endsWith('\n') ? stored : `${stored}\n`,
          mtime: '2',
        });
      },
      writeDoc(_vault, path, source) {
        state.writes.push(source);
        const held = state.hold;
        if (held === undefined) {
          files.set(path, source);
          return Promise.resolve('2');
        }
        // The file lands when the write resolves, not when it was asked for, so
        // a delete queued behind one held open can be told apart from a delete
        // that overtook it.
        return held.promise.then(function () {
          files.set(path, source);
          return '2';
        });
      },
      createDoc() {
        return Promise.resolve();
      },
      createGroup() {
        return Promise.resolve();
      },
      renameGroup() {
        return Promise.resolve();
      },
      renameDoc() {
        return Promise.resolve();
      },
      deleteDoc(_vault, path) {
        state.deleted.push(path);
        files.delete(path);
        return Promise.resolve();
      },
      deleteGroup(_vault, group) {
        state.deleted.push(group);
        [...files.keys()]
          .filter(function (path) {
            return path.startsWith(`${group}/`);
          })
          .forEach(function (path) {
            files.delete(path);
          });
        return Promise.resolve();
      },
    },
  };
  return state;
}

/** A hook with the vault chosen and one document open. */
async function opened(state: Disk, path: DocPath = DOC) {
  const view = renderHook(function () {
    return useWorkspace(state.bridge);
  });

  await act(async function () {
    view.result.current.chooseVault(VAULT);
  });
  await act(async function () {
    view.result.current.openDoc(path);
  });

  return view;
}

describe('flush', function () {
  it('should resolve without writing when the buffer is clean', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      await result.current.flush();
    });

    expect(state.writes).toEqual([]);
  });

  // The point of awaiting it: an authorized turn may read the file, and it
  // should read what the writer is looking at rather than what the autosave
  // last got round to.
  it('should write before it resolves when the buffer is dirty', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);
    state.hold = gate();

    await act(async function () {
      result.current.editDraft('The ending, tightened.');
    });

    let settled = false;
    let flushing: Promise<void> = Promise.resolve();
    await act(async function () {
      flushing = result.current.flush().then(function () {
        settled = true;
      });
    });

    // The write is out, and the flush has not resolved behind its back.
    expect(state.writes).toEqual(['The ending, tightened.']);
    expect(settled).toBe(false);

    await act(async function () {
      state.hold?.open();
      await flushing;
    });

    expect(settled).toBe(true);
  });
});

describe('land', function () {
  it('should write the edit and replace the buffer with what the read returned', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);
    const before = state.reads;

    await act(async function () {
      await result.current.land('The ending, tightened.', DOC);
    });

    expect(state.writes).toEqual(['The ending, tightened.']);
    expect(state.reads).toBe(before + 1);
    // Not the text that was written: the trailing newline came off the disk.
    expect(result.current.open?.draft).toBe('The ending, tightened.\n');
    expect(result.current.open?.saved).toBe('The ending, tightened.\n');
    expect(result.current.dirty).toBe(false);
  });

  // A landing is the only change in flight when the writer has typed nothing,
  // so it cannot be guarded on dirtiness the way the autosave is.
  it('should write even when the buffer was clean', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      await result.current.land('Replaced wholesale.', DOC);
    });

    expect(state.writes).toEqual(['Replaced wholesale.']);
  });

  it('should surface a write that failed rather than showing text disk never took', async function () {
    const state = disk('The ending.\n');
    state.bridge.writeDoc = function () {
      return Promise.reject(new Error('read-only file system'));
    };
    const {result} = await opened(state);

    await act(async function () {
      await result.current.land('The ending, tightened.', DOC);
    });

    expect(result.current.open?.save).toEqual({
      kind: 'failed',
      message: 'read-only file system',
    });
    expect(result.current.open?.draft).toBe('The ending.\n');
  });

  // The writer moved to another document while the agent was thinking. A quote
  // two documents share, because they came from the same template, would match
  // in the wrong one, so the landing is refused on the path rather than on
  // whether the passage happens to be findable.
  it('should refuse an edit meant for a document that is not the open one', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      await result.current.land('The ending, tightened.', 'elsewhere.md' as DocPath);
    });

    expect(state.writes).toEqual([]);
    expect(result.current.open?.draft).toBe('The ending.\n');
  });

  // Said out loud. The agent's reply claims an edit that is not going to
  // happen, and a writer told nothing would have no way to know.
  it('should say which document the refused edit was for', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      await result.current.land('The ending, tightened.', 'elsewhere.md' as DocPath);
    });

    expect(result.current.error).toContain('elsewhere.md');
  });

  it('should refuse an edit from a turn that carried no document at all', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      await result.current.land('The ending, tightened.', undefined);
    });

    expect(state.writes).toEqual([]);
  });
});

describe('two writers over one file', function () {
  // The autosave and a landing both write the whole document. Unordered, a save
  // that was already in flight can finish after the landing and leave disk
  // holding the draft the edit replaced, with the buffer already marked clean
  // by the read-back, so nothing ever writes the edit again.
  it('should hold a landing behind a write that was already in flight', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);
    state.hold = gate();

    await act(async function () {
      result.current.editDraft('The ending, typed.');
    });

    let flushing: Promise<void> = Promise.resolve();
    let landing: Promise<void> = Promise.resolve();
    await act(async function () {
      flushing = result.current.flush();
      landing = result.current.land('The ending, typed and tightened.', DOC);
    });

    // The landing has not begun: the flush's write still has the file.
    expect(state.writes).toEqual(['The ending, typed.']);

    await act(async function () {
      state.hold?.open();
      await flushing;
      await landing;
    });

    expect(state.writes).toEqual(['The ending, typed.', 'The ending, typed and tightened.']);
    expect(result.current.open?.draft).toBe('The ending, typed and tightened.\n');
  });
});

describe('deleting', function () {
  // The next autosave would otherwise write to a file that is not there, and
  // the editor would be showing a document the vault no longer holds.
  it('should close the open document when it is the one deleted', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      result.current.deleteDoc(DOC);
    });

    expect(result.current.open).toBeUndefined();
    expect(state.deleted).toEqual([DOC]);
  });

  it('should leave the open document alone when another one is deleted', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      result.current.deleteDoc(NESTED);
    });

    expect(result.current.open?.path).toBe(DOC);
  });

  it('should close the open document when the group holding it is deleted', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state, NESTED);

    await act(async function () {
      result.current.deleteGroup(GROUP);
    });

    expect(result.current.open).toBeUndefined();
    expect(state.deleted).toEqual([GROUP]);
  });

  it('should leave a document outside the deleted group open', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);

    await act(async function () {
      result.current.deleteGroup(GROUP);
    });

    expect(result.current.open?.path).toBe(DOC);
  });

  // The reason a delete joins the write queue at all: a save already in flight
  // would otherwise finish after the delete and put the file straight back,
  // leaving a ghost document with none of the rows that were swept with it.
  it('should run after a write that was already in flight, and the file should not come back', async function () {
    const state = disk('The ending.\n');
    const {result} = await opened(state);
    state.hold = gate();

    await act(async function () {
      result.current.editDraft('The ending, typed.');
    });

    let flushing: Promise<void> = Promise.resolve();
    await act(async function () {
      flushing = result.current.flush();
      result.current.deleteDoc(DOC);
    });

    // The delete has not begun: the flush's write still has the file.
    expect(state.writes).toEqual(['The ending, typed.']);
    expect(state.deleted).toEqual([]);

    await act(async function () {
      state.hold?.open();
      await flushing;
      // Queued behind the delete, so it resolves only once the delete is done.
      await result.current.flush();
    });

    expect(state.deleted).toEqual([DOC]);
    expect(state.files.has(DOC)).toBe(false);
  });
});

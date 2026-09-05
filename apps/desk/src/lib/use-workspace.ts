import {useCallback, useEffect, useMemo, useReducer, useRef} from 'react';
import {
  rewriteUnder,
  summarize,
  templateFor,
  templatePathFor,
  type DocKind,
  type DocPath,
  type GroupPath,
  type VaultPath,
} from '@inkling/vault';
import {
  createDoc as createDocCommand,
  createGroup as createGroupCommand,
  isoFromEpoch,
  listDocs,
  listGroups,
  openVaultDb,
  readDoc,
  renameDoc,
  renameGroup as renameGroupCommand,
  writeDoc,
  type DocFile,
  type VaultDbStatus,
} from './bridge.ts';
import {
  INITIAL_WORKSPACE,
  isDirty,
  workspaceReducer,
  type WorkspaceState,
} from './workspace-state.ts';

/** How long the editor sits quiet before the draft is written to disk. */
const AUTOSAVE_MS = 800;

/**
 * The Rust calls this hook makes, as one value.
 *
 * Taken as a parameter rather than reached for at each call site so the hook is
 * drivable with no webview, the way `daemon-token.ts` takes its three Tauri
 * calls as `TokenPrimitives`. A `mock.module` on `bridge.ts` would do the same
 * job and register in bun's run-global mock registry, reaching every other file
 * that imports it.
 */
export type WorkspaceBridge = {
  listDocs: (vault: VaultPath) => Promise<DocFile[]>;
  listGroups: (vault: VaultPath) => Promise<string[]>;
  openVaultDb: (vault: VaultPath) => Promise<VaultDbStatus>;
  readDoc: (vault: VaultPath, path: DocPath) => Promise<DocFile>;
  writeDoc: (vault: VaultPath, path: DocPath, source: string) => Promise<string>;
  createDoc: (vault: VaultPath, path: DocPath, source: string) => Promise<void>;
  createGroup: (vault: VaultPath, path: GroupPath) => Promise<void>;
  renameGroup: (vault: VaultPath, from: GroupPath, to: GroupPath) => Promise<void>;
  renameDoc: (vault: VaultPath, from: DocPath, to: DocPath) => Promise<void>;
};

/** The shipped one. Held at module scope so its identity never moves. */
export const TAURI_WORKSPACE: WorkspaceBridge = {
  listDocs,
  listGroups,
  openVaultDb,
  readDoc,
  writeDoc,
  createDoc: createDocCommand,
  createGroup: createGroupCommand,
  renameGroup: renameGroupCommand,
  renameDoc,
};

export type Workspace = WorkspaceState & {
  chooseVault: (vault: VaultPath) => void;
  openDoc: (path: DocPath) => void;
  closeDoc: () => void;
  editDraft: (draft: string) => void;
  /** Writes the open draft now, bypassing the autosave delay. */
  saveNow: () => void;
  /**
   * The same write, awaited. Resolves at once when the buffer is clean, and
   * otherwise once the draft is on disk, so the agent reads the file the writer
   * is looking at rather than the one they had a second ago.
   */
  flush: () => Promise<void>;
  /**
   * Writes `source` to `path` and replaces the buffer with what reading the
   * file back returns. Refuses when `path` is not the open document.
   *
   * The read-back is the point: the buffer ends up holding what disk actually
   * holds, never what inkling believed it had written.
   */
  land: (source: string, path: DocPath | undefined) => Promise<void>;
  refresh: () => void;
  /** Makes a group, and every group above it that does not exist yet. */
  createGroup: (path: GroupPath) => void;
  /** Renames a group, carrying everything stored against the documents inside. */
  renameGroup: (from: GroupPath, to: GroupPath) => void;
  /** Moves one document to another group, or out to the vault root. */
  moveDoc: (from: DocPath, to: DocPath) => void;
  /** Writes a new document from its kind's template, and opens it. */
  createDoc: (path: DocPath, title: string, kind: DocKind) => void;
  dirty: boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the writer is told when an agent's edit arrived for another document. */
function strayEdit(path: DocPath | undefined): string {
  if (path === undefined) {
    return 'The agent sent an edit, but its turn was not about any document.';
  }
  return `The agent's edit was for ${path}, which is not the open document any more.`;
}

/**
 * Owns the vault, the document list and the open buffer.
 *
 * The effects here are all one shape: kick off an async read or write, then
 * dispatch a path-tagged action so the reducer can drop a result that arrived
 * after the writer moved on.
 */
export function useWorkspace(bridge: WorkspaceBridge = TAURI_WORKSPACE): Workspace {
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_WORKSPACE);
  const vault = state.vault;

  const refresh = useCallback(
    function () {
      if (vault === undefined) return;
      dispatch({type: 'loadingStarted'});
      // One round trip's latency rather than two: neither listing needs the
      // other's answer.
      Promise.all([bridge.listDocs(vault), bridge.listGroups(vault)])
        .then(function ([files, dirs]) {
          const docs = files.map(function (file) {
            return summarize(file.path as DocPath, file.source, isoFromEpoch(file.mtime));
          });
          const sources = new Map(
            files.map(function (file): [DocPath, string] {
              return [file.path as DocPath, file.source];
            }),
          );
          dispatch({type: 'docsLoaded', docs, groups: dirs as GroupPath[], sources});
        })
        .catch(function (error) {
          console.error('inkling: failed to scan the vault', error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, bridge],
  );

  useEffect(
    function () {
      refresh();
    },
    [refresh],
  );

  // Opening the vault's database is a second, independent effect: the document
  // list must not wait on it, and a database that will not open must not stop
  // the vault from being read. There is no matching close on cleanup, because
  // React runs the cleanup and the next effect body without awaiting either
  // invoke; the Rust side swaps the connection under one lock instead.
  useEffect(
    function () {
      if (vault === undefined) return;
      let live = true;
      bridge
        .openVaultDb(vault)
        .then(function (status) {
          if (!live) return;
          if (status.kind === 'ready') {
            dispatch({type: 'dataReady', schemaVersion: status.schemaVersion});
          } else {
            dispatch({type: 'dataUnavailable', message: status.message});
          }
        })
        .catch(function (error) {
          console.error('inkling: failed to open the vault database', error);
          if (live) dispatch({type: 'dataUnavailable', message: message(error)});
        });
      return function () {
        live = false;
      };
    },
    [vault, bridge],
  );

  const chooseVault = useCallback(function (next: VaultPath) {
    dispatch({type: 'vaultChosen', vault: next});
  }, []);

  const openDoc = useCallback(
    function (path: DocPath) {
      if (vault === undefined) return;
      dispatch({type: 'loadingStarted'});
      bridge
        .readDoc(vault, path)
        .then(function (file) {
          dispatch({type: 'docOpened', path, source: file.source});
        })
        .catch(function (error) {
          console.error(`inkling: failed to open ${path}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, bridge],
  );

  const closeDoc = useCallback(function () {
    dispatch({type: 'docClosed'});
  }, []);

  const editDraft = useCallback(
    function (draft: string) {
      const path = state.open?.path;
      if (path === undefined) return;
      dispatch({type: 'draftEdited', path, draft});
    },
    [state.open?.path],
  );

  // Held in a ref so `saveNow` and the autosave timer share one implementation
  // without either of them re-creating on every keystroke.
  const openRef = useRef(state.open);
  openRef.current = state.open;

  // The same trick for the vault's sources, which `createDoc` reads a template
  // override out of. Depending on the map itself would give `createDoc` a new
  // identity after every vault scan, and re-render every memoised group row.
  const sourcesRef = useRef(state.sources);
  sourcesRef.current = state.sources;

  const createGroup = useCallback(
    function (path: GroupPath) {
      if (vault === undefined) return;
      bridge
        .createGroup(vault, path)
        .then(refresh)
        .catch(function (error) {
          console.error(`inkling: failed to make the group ${path}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh, bridge],
  );

  const renameGroup = useCallback(
    function (from: GroupPath, to: GroupPath) {
      if (vault === undefined) return;
      bridge
        .renameGroup(vault, from, to)
        .then(function () {
          refresh();
          // The open document's path has just changed underneath it. Reopening
          // at the new one is what stops the next autosave writing to a file
          // that is no longer there.
          const path = openRef.current?.path;
          if (path === undefined) return;
          const moved = rewriteUnder(path, from, to) as DocPath;
          if (moved !== path) openDoc(moved);
        })
        .catch(function (error) {
          console.error(`inkling: failed to rename ${from} to ${to}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh, openDoc, bridge],
  );

  const moveDoc = useCallback(
    function (from: DocPath, to: DocPath) {
      if (vault === undefined) return;
      bridge
        .renameDoc(vault, from, to)
        .then(function () {
          refresh();
          if (openRef.current?.path === from) openDoc(to);
        })
        .catch(function (error) {
          console.error(`inkling: failed to move ${from} to ${to}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh, openDoc, bridge],
  );

  const createDoc = useCallback(
    function (path: DocPath, title: string, kind: DocKind) {
      if (vault === undefined) return;
      // A writer's own `templates/<kind>.md` wins over the built-in skeleton.
      // It is already in hand: the vault scan loaded every document's source,
      // so this is a map lookup rather than a second read of the disk.
      const override = sourcesRef.current.get(templatePathFor(kind));
      // `bridge.createDoc`, not `writeDoc`: two titles that slug to the same
      // filename must not silently overwrite the first one's prose.
      bridge
        .createDoc(vault, path, templateFor(kind, title, new Date().toISOString(), override))
        .then(function () {
          refresh();
          openDoc(path);
        })
        .catch(function (error) {
          console.error(`inkling: failed to create ${path}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh, openDoc, bridge],
  );

  /**
   * One writer for the open document, in the order the calls arrived.
   *
   * The autosave and an agent's landing are two callers reaching for the same
   * file, and unordered they can leave disk holding the older of the two: the
   * landing writes the edit, an autosave that was already in flight finishes
   * afterwards with the draft the edit replaced, and the landing's read-back
   * has already marked the buffer clean, so nothing ever writes the edit again.
   * Queued, the landing simply waits its turn, and a save that reaches the
   * front of the queue with nothing left to do finds the buffer clean and
   * writes nothing.
   *
   * Every guard below therefore reads `openRef` inside the queued work rather
   * than when the call was made.
   */
  const writing = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback(function (work: () => Promise<void>): Promise<void> {
    // Both settled paths, because one rejection would otherwise leave the chain
    // rejected and every later write unqueued. Neither caller's work rejects.
    const next = writing.current.then(work, work);
    writing.current = next;
    return next;
  }, []);

  /**
   * Writes the open draft, and resolves when it is on disk.
   *
   * The promise is what `flush` is: an autosave that nobody awaits and an agent
   * turn that must not start until the file matches the buffer are the same
   * write, so they are the same function under two names rather than two
   * writers racing each other for one file.
   */
  const save = useCallback(
    function (): Promise<void> {
      return enqueue(function () {
        const open = openRef.current;
        if (vault === undefined || open === undefined || !isDirty(open)) return Promise.resolve();
        const {path, draft} = open;
        dispatch({type: 'saveStarted', path});
        return bridge
          .writeDoc(vault, path, draft)
          .then(function () {
            dispatch({type: 'saveSucceeded', path, source: draft});
          })
          .catch(function (error) {
            console.error(`inkling: failed to save ${path}`, error);
            dispatch({type: 'saveFailed', path, message: message(error)});
          });
      });
    },
    [vault, bridge, enqueue],
  );

  /**
   * Writes an agent's edit and replaces the buffer with what disk came back
   * with, rather than with what was sent.
   *
   * Guarded on the document rather than on dirtiness: a landing may be the only
   * change in flight, and one whose result matched the draft byte for byte
   * would never reach the file if it were guarded the way `save` is.
   */
  const land = useCallback(
    function (source: string, path: DocPath | undefined): Promise<void> {
      return enqueue(function () {
        const open = openRef.current;
        if (vault === undefined || open === undefined) return Promise.resolve();
        // The document the turn was about, not whichever one is open now. A
        // writer who moved on while the agent was thinking must not have its
        // edit written into a file it never read, and a quoted passage that two
        // documents share (they were made from the same template) would
        // otherwise match in the wrong one. Said out loud rather than dropped:
        // the agent's reply claims an edit that is not going to happen.
        if (path !== open.path) {
          dispatch({type: 'failed', message: strayEdit(path)});
          return Promise.resolve();
        }
        dispatch({type: 'saveStarted', path});
        return bridge
          .writeDoc(vault, path, source)
          .then(function () {
            return bridge.readDoc(vault, path);
          })
          .then(function (file) {
            dispatch({type: 'docReloaded', path, source: file.source});
          })
          .catch(function (error) {
            console.error(`inkling: failed to land an edit in ${path}`, error);
            dispatch({type: 'saveFailed', path, message: message(error)});
          });
      });
    },
    [vault, bridge, enqueue],
  );

  const draft = state.open?.draft;
  useEffect(
    function () {
      if (state.open === undefined || !isDirty(state.open)) return;
      const timer = setTimeout(save, AUTOSAVE_MS);
      return function () {
        clearTimeout(timer);
      };
    },
    // `draft` is the trigger: every keystroke restarts the quiet period.
    [draft, state.open, save],
  );

  const dirty = useMemo(
    function () {
      return state.open !== undefined && isDirty(state.open);
    },
    [state.open],
  );

  return {
    ...state,
    chooseVault,
    openDoc,
    closeDoc,
    editDraft,
    saveNow: save,
    flush: save,
    land,
    refresh,
    createGroup,
    renameGroup,
    moveDoc,
    createDoc,
    dirty,
  };
}

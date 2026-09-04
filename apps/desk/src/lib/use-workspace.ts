import {useCallback, useEffect, useMemo, useReducer, useRef} from 'react';
import {summarize, type DocPath, type VaultPath} from '@inkling/vault';
import {isoFromEpoch, listDocs, openVaultDb, readDoc, writeDoc} from './bridge.ts';
import {
  INITIAL_WORKSPACE,
  isDirty,
  workspaceReducer,
  type WorkspaceState,
} from './workspace-state.ts';

/** How long the editor sits quiet before the draft is written to disk. */
const AUTOSAVE_MS = 800;

export type Workspace = WorkspaceState & {
  chooseVault: (vault: VaultPath) => void;
  openDoc: (path: DocPath) => void;
  closeDoc: () => void;
  editDraft: (draft: string) => void;
  /** Writes the open draft now, bypassing the autosave delay. */
  saveNow: () => void;
  refresh: () => void;
  dirty: boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the vault, the document list and the open buffer.
 *
 * The effects here are all one shape: kick off an async read or write, then
 * dispatch a path-tagged action so the reducer can drop a result that arrived
 * after the writer moved on.
 */
export function useWorkspace(): Workspace {
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_WORKSPACE);
  const vault = state.vault;

  const refresh = useCallback(
    function () {
      if (vault === undefined) return;
      dispatch({type: 'loadingStarted'});
      listDocs(vault)
        .then(function (files) {
          const docs = files.map(function (file) {
            return summarize(file.path as DocPath, file.source, isoFromEpoch(file.mtime));
          });
          const sources = new Map(
            files.map(function (file): [DocPath, string] {
              return [file.path as DocPath, file.source];
            }),
          );
          dispatch({type: 'docsLoaded', docs, sources});
        })
        .catch(function (error) {
          console.error('inkling: failed to scan the vault', error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault],
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
      openVaultDb(vault)
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
    [vault],
  );

  const chooseVault = useCallback(function (next: VaultPath) {
    dispatch({type: 'vaultChosen', vault: next});
  }, []);

  const openDoc = useCallback(
    function (path: DocPath) {
      if (vault === undefined) return;
      dispatch({type: 'loadingStarted'});
      readDoc(vault, path)
        .then(function (file) {
          dispatch({type: 'docOpened', path, source: file.source});
        })
        .catch(function (error) {
          console.error(`inkling: failed to open ${path}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault],
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

  const save = useCallback(
    function () {
      const open = openRef.current;
      if (vault === undefined || open === undefined || !isDirty(open)) return;
      const {path, draft} = open;
      dispatch({type: 'saveStarted', path});
      writeDoc(vault, path, draft)
        .then(function () {
          dispatch({type: 'saveSucceeded', path, source: draft});
        })
        .catch(function (error) {
          console.error(`inkling: failed to save ${path}`, error);
          dispatch({type: 'saveFailed', path, message: message(error)});
        });
    },
    [vault],
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

  return {...state, chooseVault, openDoc, closeDoc, editDraft, saveNow: save, refresh, dirty};
}

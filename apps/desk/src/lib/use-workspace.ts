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
} from './bridge.ts';
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
      // One round trip's latency rather than two: neither listing needs the
      // other's answer.
      Promise.all([listDocs(vault), listGroups(vault)])
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

  // The same trick for the vault's sources, which `createDoc` reads a template
  // override out of. Depending on the map itself would give `createDoc` a new
  // identity after every vault scan, and re-render every memoised group row.
  const sourcesRef = useRef(state.sources);
  sourcesRef.current = state.sources;

  const createGroup = useCallback(
    function (path: GroupPath) {
      if (vault === undefined) return;
      createGroupCommand(vault, path)
        .then(refresh)
        .catch(function (error) {
          console.error(`inkling: failed to make the group ${path}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh],
  );

  const renameGroup = useCallback(
    function (from: GroupPath, to: GroupPath) {
      if (vault === undefined) return;
      renameGroupCommand(vault, from, to)
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
    [vault, refresh, openDoc],
  );

  const moveDoc = useCallback(
    function (from: DocPath, to: DocPath) {
      if (vault === undefined) return;
      renameDoc(vault, from, to)
        .then(function () {
          refresh();
          if (openRef.current?.path === from) openDoc(to);
        })
        .catch(function (error) {
          console.error(`inkling: failed to move ${from} to ${to}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh, openDoc],
  );

  const createDoc = useCallback(
    function (path: DocPath, title: string, kind: DocKind) {
      if (vault === undefined) return;
      // A writer's own `templates/<kind>.md` wins over the built-in skeleton.
      // It is already in hand: the vault scan loaded every document's source,
      // so this is a map lookup rather than a second read of the disk.
      const override = sourcesRef.current.get(templatePathFor(kind));
      // `createDocCommand`, not `writeDoc`: two titles that slug to the same
      // filename must not silently overwrite the first one's prose.
      createDocCommand(vault, path, templateFor(kind, title, new Date().toISOString(), override))
        .then(function () {
          refresh();
          openDoc(path);
        })
        .catch(function (error) {
          console.error(`inkling: failed to create ${path}`, error);
          dispatch({type: 'failed', message: message(error)});
        });
    },
    [vault, refresh, openDoc],
  );

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

  return {
    ...state,
    chooseVault,
    openDoc,
    closeDoc,
    editDraft,
    saveNow: save,
    refresh,
    createGroup,
    renameGroup,
    moveDoc,
    createDoc,
    dirty,
  };
}

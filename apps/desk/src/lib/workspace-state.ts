import {match} from 'ts-pattern';
import type {DocPath, DocSummary, VaultPath} from '@inkling/vault';

/**
 * The workspace reducer: every change to which document is open and what the
 * editor holds passes through here. Pure and synchronous, so the rules about
 * dirty state and stale loads are testable without a filesystem.
 */

export type SaveState =
  {kind: 'clean'} | {kind: 'dirty'} | {kind: 'saving'} | {kind: 'failed'; message: string};

export type OpenDoc = {
  path: DocPath;
  /** What the editor currently holds. */
  draft: string;
  /** What is known to be on disk, so dirtiness is a comparison and not a flag. */
  saved: string;
  save: SaveState;
};

/**
 * The vault's database, as the effect layer reports it.
 *
 * Declared here rather than imported from `bridge.ts` so the reducer's import
 * graph stays free of Tauri and the filesystem. `use-workspace.ts` is what
 * bridges the two shapes.
 */
export type VaultData =
  | {kind: 'opening'}
  | {kind: 'ready'; schemaVersion: number}
  | {kind: 'unavailable'; message: string};

export type WorkspaceState = {
  vault: VaultPath | undefined;
  docs: DocSummary[];
  /**
   * Every document's body, keyed by path. The vault scan reads them anyway, so
   * keeping them lets the agent's context picker and full-text search work
   * without a read per file. See the note on `list_docs` in `vault.rs`.
   */
  sources: ReadonlyMap<DocPath, string>;
  open: OpenDoc | undefined;
  /** Set while a vault scan or a document load is in flight. */
  loading: boolean;
  error: string | undefined;
  /** Whether everything inkling stores beyond the prose is available. */
  data: VaultData;
};

export type WorkspaceAction =
  | {type: 'vaultChosen'; vault: VaultPath}
  | {type: 'docsLoaded'; docs: DocSummary[]; sources: ReadonlyMap<DocPath, string>}
  | {type: 'docOpened'; path: DocPath; source: string}
  | {type: 'docClosed'}
  | {type: 'draftEdited'; path: DocPath; draft: string}
  | {type: 'saveStarted'; path: DocPath}
  | {type: 'saveSucceeded'; path: DocPath; source: string}
  | {type: 'saveFailed'; path: DocPath; message: string}
  | {type: 'loadingStarted'}
  | {type: 'failed'; message: string}
  | {type: 'dataReady'; schemaVersion: number}
  | {type: 'dataUnavailable'; message: string};

export const INITIAL_WORKSPACE: WorkspaceState = {
  vault: undefined,
  docs: [],
  sources: new Map(),
  open: undefined,
  loading: false,
  error: undefined,
  data: {kind: 'opening'},
};

/** Most recently touched first, which is the order a writer looks for work in. */
export function sortDocs(docs: DocSummary[]): DocSummary[] {
  return [...docs].sort(function (a, b) {
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function isDirty(open: OpenDoc): boolean {
  return open.draft !== open.saved;
}

/**
 * What to tell the writer when the vault's database will not open, or
 * `undefined` when there is nothing to say.
 *
 * It names the recovery, because deleting `.inkling/` is the whole recovery
 * story: everything in there is regenerable, and none of it is their prose.
 */
export function dataNotice(data: VaultData): string | undefined {
  if (data.kind !== 'unavailable') return undefined;
  return `${data.message}. Anything inkling stores beyond your writing is unavailable in this vault. Deleting its .inkling folder resets it.`;
}

/**
 * Applies an action to the open document only when it names the document that
 * is actually open.
 *
 * Saves and edits both carry their path because they resolve asynchronously: a
 * writer who switches documents mid-save must not have the old file's result
 * land in the new file's buffer.
 */
function updateOpen(
  state: WorkspaceState,
  path: DocPath,
  change: (open: OpenDoc) => OpenDoc,
): WorkspaceState {
  if (state.open === undefined || state.open.path !== path) return state;
  return {...state, open: change(state.open)};
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  return match<WorkspaceAction, WorkspaceState>(action)
    .with({type: 'vaultChosen'}, function ({vault}) {
      // A new vault invalidates everything the old one populated.
      return {...INITIAL_WORKSPACE, vault, loading: true};
    })
    .with({type: 'docsLoaded'}, function ({docs, sources}) {
      return {...state, docs: sortDocs(docs), sources, loading: false, error: undefined};
    })
    .with({type: 'docOpened'}, function ({path, source}) {
      return {
        ...state,
        loading: false,
        error: undefined,
        open: {path, draft: source, saved: source, save: {kind: 'clean'}},
      };
    })
    .with({type: 'docClosed'}, function () {
      return {...state, open: undefined};
    })
    .with({type: 'draftEdited'}, function ({path, draft}) {
      return updateOpen(state, path, function (open) {
        const save: SaveState = draft === open.saved ? {kind: 'clean'} : {kind: 'dirty'};
        return {...open, draft, save};
      });
    })
    .with({type: 'saveStarted'}, function ({path}) {
      return updateOpen(state, path, function (open) {
        return {...open, save: {kind: 'saving'}};
      });
    })
    .with({type: 'saveSucceeded'}, function ({path, source}) {
      return updateOpen(state, path, function (open) {
        // The draft may have moved on while the write was in flight, so the
        // saved marker advances to what was written and dirtiness re-derives.
        const save: SaveState = open.draft === source ? {kind: 'clean'} : {kind: 'dirty'};
        return {...open, saved: source, save};
      });
    })
    .with({type: 'saveFailed'}, function ({path, message}) {
      return updateOpen(state, path, function (open) {
        return {...open, save: {kind: 'failed', message}};
      });
    })
    .with({type: 'loadingStarted'}, function () {
      return {...state, loading: true, error: undefined};
    })
    .with({type: 'failed'}, function ({message}) {
      return {...state, loading: false, error: message};
    })
    .with({type: 'dataReady'}, function ({schemaVersion}) {
      return {...state, data: {kind: 'ready', schemaVersion}};
    })
    .with({type: 'dataUnavailable'}, function ({message}) {
      // The vault still lists and edits. Only what inkling stores beside the
      // prose is missing, so nothing else in the state changes.
      return {...state, data: {kind: 'unavailable', message}};
    })
    .exhaustive();
}

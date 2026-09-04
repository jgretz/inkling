import {describe, expect, it} from 'bun:test';
import type {DocPath, DocSummary, VaultPath} from '@inkling/vault';
import {
  INITIAL_WORKSPACE,
  isDirty,
  sortDocs,
  workspaceReducer,
  type WorkspaceState,
} from '../src/lib/workspace-state.ts';

const vault = '/Users/josh/vault' as VaultPath;
const first = 'a.md' as DocPath;
const second = 'b.md' as DocPath;

function summary(path: DocPath, updatedAt: string): DocSummary {
  return {path, title: path, kind: undefined, tags: [], updatedAt, words: 0};
}

/** A workspace with `first` open and its saved body equal to `source`. */
function opened(source: string): WorkspaceState {
  return workspaceReducer(workspaceReducer(INITIAL_WORKSPACE, {type: 'vaultChosen', vault}), {
    type: 'docOpened',
    path: first,
    source,
  });
}

describe('sortDocs', function () {
  it('should put the most recently updated first', function () {
    const docs = [
      summary(first, '2026-01-01T00:00:00.000Z'),
      summary(second, '2026-06-01T00:00:00.000Z'),
    ];

    expect(sortDocs(docs).map((doc) => doc.path)).toEqual([second, first]);
  });
});

describe('workspaceReducer', function () {
  it('should clear the previous vault entirely when a new one is chosen', function () {
    const state = opened('body');

    const next = workspaceReducer(state, {type: 'vaultChosen', vault: '/other' as VaultPath});

    expect(next.open).toBeUndefined();
    expect(next.docs).toEqual([]);
    expect(next.vault).toBe('/other' as VaultPath);
  });

  it('should open a document clean', function () {
    const state = opened('body');

    expect(state.open?.save).toEqual({kind: 'clean'});
    expect(isDirty(state.open!)).toBe(false);
  });

  it('should mark the document dirty when the draft diverges', function () {
    const state = workspaceReducer(opened('body'), {
      type: 'draftEdited',
      path: first,
      draft: 'body changed',
    });

    expect(state.open?.save).toEqual({kind: 'dirty'});
  });

  it('should return to clean when an edit is undone back to the saved text', function () {
    const edited = workspaceReducer(opened('body'), {
      type: 'draftEdited',
      path: first,
      draft: 'body changed',
    });

    const undone = workspaceReducer(edited, {type: 'draftEdited', path: first, draft: 'body'});

    expect(undone.open?.save).toEqual({kind: 'clean'});
  });

  it('should ignore an edit aimed at a document that is no longer open', function () {
    const state = opened('body');

    const next = workspaceReducer(state, {type: 'draftEdited', path: second, draft: 'other'});

    expect(next).toBe(state);
  });

  it('should stay dirty when the draft moved on while the save was in flight', function () {
    const editedTwice = workspaceReducer(
      workspaceReducer(opened('v1'), {type: 'draftEdited', path: first, draft: 'v2'}),
      {type: 'draftEdited', path: first, draft: 'v3'},
    );

    // The write that lands carries v2, the text as it was when the save started.
    const saved = workspaceReducer(editedTwice, {
      type: 'saveSucceeded',
      path: first,
      source: 'v2',
    });

    expect(saved.open?.saved).toBe('v2');
    expect(saved.open?.save).toEqual({kind: 'dirty'});
  });

  it('should not apply a save result to a document opened since', function () {
    const switched = workspaceReducer(opened('v1'), {
      type: 'docOpened',
      path: second,
      source: 'other',
    });

    const next = workspaceReducer(switched, {type: 'saveSucceeded', path: first, source: 'v2'});

    expect(next.open?.path).toBe(second);
    expect(next.open?.draft).toBe('other');
  });

  it('should surface a save failure with its message', function () {
    const dirty = workspaceReducer(opened('v1'), {
      type: 'draftEdited',
      path: first,
      draft: 'v2',
    });

    const failed = workspaceReducer(dirty, {
      type: 'saveFailed',
      path: first,
      message: 'read-only file system',
    });

    expect(failed.open?.save).toEqual({kind: 'failed', message: 'read-only file system'});
  });

  it('should clear a previous error when a new load starts', function () {
    const failed = workspaceReducer(INITIAL_WORKSPACE, {type: 'failed', message: 'boom'});

    const next = workspaceReducer(failed, {type: 'loadingStarted'});

    expect(next.error).toBeUndefined();
    expect(next.loading).toBe(true);
  });
});

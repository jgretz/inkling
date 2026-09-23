import {afterEach, beforeEach, describe, expect, it, spyOn, type Mock} from 'bun:test';
import type {DocPath, DocSummary, GroupPath} from '@inkling/vault';
import {
  askDeleteConversation,
  askDeleteDoc,
  askDeleteGroup,
  askRestoreRevision,
  type Confirm,
} from '../src/lib/ask-first.ts';
import {docDeletePrompt, groupDeletePrompt} from '../src/lib/deletion.ts';

/**
 * The confirm-then-act commands, driven through an injected dialog.
 *
 * Never mock the Tauri dialog plugin as a module: bun's module-mock registry is
 * global to a run, so one suite's mock would reach every other file that
 * imports the same module. That is why the dialog is a value here.
 */

type Asked = {message: string; options: {title: string; kind: 'warning'}};

/** A dialog that answers `answer` (or fails with it) and records what it was asked. */
function dialog(answer: boolean | Error): {confirm: Confirm; asked: Asked[]} {
  const asked: Asked[] = [];
  return {
    asked,
    confirm(message, options) {
      asked.push({message, options});
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    },
  };
}

/** A recorder for whatever a command would run, in the order it ran. */
function recorder<T>(): {calls: T[]; record: (value: T) => void} {
  const calls: T[] = [];
  return {
    calls,
    record(value) {
      calls.push(value);
    },
  };
}

function summary(path: string, title: string): DocSummary {
  return {path: path as DocPath, title, kind: undefined, tags: [], updatedAt: '', words: 0};
}

const DIALOG_FAILED = new Error('the dialog plugin is not there');

let warn: Mock<typeof console.warn>;

beforeEach(function () {
  warn = spyOn(console, 'warn').mockImplementation(function () {});
});

afterEach(function () {
  warn.mockRestore();
});

describe('askDeleteConversation', function () {
  const doomed = {id: 7, title: 'Tightening the ending'};

  it('should remove the conversation when the writer agrees', async function () {
    const {confirm} = dialog(true);
    const removed = recorder<number>();

    await askDeleteConversation(confirm, doomed, removed.record);

    expect(removed.calls).toEqual([7]);
  });

  it('should remove nothing when the writer refuses', async function () {
    const {confirm} = dialog(false);
    const removed = recorder<number>();

    await askDeleteConversation(confirm, doomed, removed.record);

    expect(removed.calls).toEqual([]);
  });

  it('should remove nothing and warn when the dialog fails', async function () {
    const {confirm} = dialog(DIALOG_FAILED);
    const removed = recorder<number>();

    await expect(askDeleteConversation(confirm, doomed, removed.record)).resolves.toBeUndefined();

    expect(removed.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'inkling: could not ask about deleting a conversation',
      DIALOG_FAILED,
    );
  });

  it('should ask once, naming the conversation, when asked to delete it', async function () {
    const {confirm, asked} = dialog(false);

    await askDeleteConversation(confirm, doomed, recorder<number>().record);

    expect(asked).toEqual([
      {
        message: 'Delete "Tightening the ending" and everything said in it?',
        options: {title: 'Delete conversation', kind: 'warning'},
      },
    ]);
  });

  it('should not ask when no conversation is active', async function () {
    const {confirm, asked} = dialog(true);
    const removed = recorder<number>();

    await askDeleteConversation(confirm, undefined, removed.record);

    expect(asked).toEqual([]);
    expect(removed.calls).toEqual([]);
  });
});

describe('askDeleteDoc', function () {
  const path = 'drafts/endings.md' as DocPath;
  const docs = [summary('drafts/endings.md', 'On Endings'), summary('notes.md', 'Notes')];

  it('should delete the document when the writer agrees', async function () {
    const {confirm} = dialog(true);
    const deleted = recorder<DocPath>();

    await askDeleteDoc(confirm, docs, path, deleted.record);

    expect(deleted.calls).toEqual([path]);
  });

  it('should delete nothing when the writer refuses', async function () {
    const {confirm} = dialog(false);
    const deleted = recorder<DocPath>();

    await askDeleteDoc(confirm, docs, path, deleted.record);

    expect(deleted.calls).toEqual([]);
  });

  it('should delete nothing and warn when the dialog fails', async function () {
    const {confirm} = dialog(DIALOG_FAILED);
    const deleted = recorder<DocPath>();

    await expect(askDeleteDoc(confirm, docs, path, deleted.record)).resolves.toBeUndefined();

    expect(deleted.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'inkling: could not ask about deleting a document',
      DIALOG_FAILED,
    );
  });

  it('should ask once, naming the document by its title, when asked to delete it', async function () {
    const {confirm, asked} = dialog(false);

    await askDeleteDoc(confirm, docs, path, recorder<DocPath>().record);

    expect(asked).toEqual([
      {
        message: docDeletePrompt('On Endings'),
        options: {title: 'Delete document', kind: 'warning'},
      },
    ]);
  });

  it('should name the document by its path when no summary matches', async function () {
    const {confirm, asked} = dialog(false);
    const missing = 'gone.md' as DocPath;

    await askDeleteDoc(confirm, docs, missing, recorder<DocPath>().record);

    expect(asked).toEqual([
      {
        message: docDeletePrompt('gone.md'),
        options: {title: 'Delete document', kind: 'warning'},
      },
    ]);
  });
});

describe('askDeleteGroup', function () {
  const group = 'drafts' as GroupPath;
  const docs = [
    summary('drafts/a.md', 'A'),
    summary('drafts/2026/a.md', 'Nested A'),
    summary('drafts-old/b.md', 'Old B'),
    summary('notes.md', 'Notes'),
  ];

  it('should delete the group when the writer agrees', async function () {
    const {confirm} = dialog(true);
    const deleted = recorder<GroupPath>();

    await askDeleteGroup(confirm, docs, group, deleted.record);

    expect(deleted.calls).toEqual([group]);
  });

  it('should delete nothing when the writer refuses', async function () {
    const {confirm} = dialog(false);
    const deleted = recorder<GroupPath>();

    await askDeleteGroup(confirm, docs, group, deleted.record);

    expect(deleted.calls).toEqual([]);
  });

  it('should delete nothing and warn when the dialog fails', async function () {
    const {confirm} = dialog(DIALOG_FAILED);
    const deleted = recorder<GroupPath>();

    await expect(askDeleteGroup(confirm, docs, group, deleted.record)).resolves.toBeUndefined();

    expect(deleted.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'inkling: could not ask about deleting a group',
      DIALOG_FAILED,
    );
  });

  // Nested documents go with the group, so they are counted; a sibling that
  // only shares the prefix does not, so it is not.
  it('should ask once, counting nested documents but not prefix siblings, when asked to delete it', async function () {
    const {confirm, asked} = dialog(false);

    await askDeleteGroup(confirm, docs, group, recorder<GroupPath>().record);

    expect(asked).toEqual([
      {
        message: groupDeletePrompt('drafts', 2),
        options: {title: 'Delete group', kind: 'warning'},
      },
    ]);
  });
});

describe('askRestoreRevision', function () {
  const path = 'drafts/endings.md' as DocPath;
  const source = 'The ending, as it was.';

  /** `close` and `land`, recorded into one list so their order shows. */
  function restoreEffects(failure?: Error) {
    const steps: string[] = [];
    return {
      steps,
      effects: {
        close() {
          steps.push('close');
        },
        land(landed: string, at: DocPath) {
          steps.push(`land ${landed} at ${at}`);
          return failure === undefined ? Promise.resolve() : Promise.reject(failure);
        },
      },
    };
  }

  it('should close the panel and then land the revision when the writer agrees', async function () {
    const {confirm} = dialog(true);
    const {steps, effects} = restoreEffects();

    await askRestoreRevision(confirm, path, source, effects);

    expect(steps).toEqual(['close', `land ${source} at ${path}`]);
  });

  it('should neither close nor land when the writer refuses', async function () {
    const {confirm} = dialog(false);
    const {steps, effects} = restoreEffects();

    await askRestoreRevision(confirm, path, source, effects);

    expect(steps).toEqual([]);
  });

  it('should neither close nor land and warn when the dialog fails', async function () {
    const {confirm} = dialog(DIALOG_FAILED);
    const {steps, effects} = restoreEffects();

    await expect(askRestoreRevision(confirm, path, source, effects)).resolves.toBeUndefined();

    expect(steps).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'inkling: could not ask about restoring a revision',
      DIALOG_FAILED,
    );
  });

  it('should ask once, naming the path, when asked to restore', async function () {
    const {confirm, asked} = dialog(false);

    await askRestoreRevision(confirm, path, source, restoreEffects().effects);

    expect(asked).toEqual([
      {
        message:
          'Replace drafts/endings.md with this revision? What is in the editor now is overwritten.',
        options: {title: 'Restore revision', kind: 'warning'},
      },
    ]);
  });

  it('should not ask when no document is open', async function () {
    const {confirm, asked} = dialog(true);
    const {steps, effects} = restoreEffects();

    await askRestoreRevision(confirm, undefined, source, effects);

    expect(asked).toEqual([]);
    expect(steps).toEqual([]);
  });

  it('should resolve and warn when landing fails after a yes', async function () {
    const {confirm} = dialog(true);
    const failed = new Error('the path is no longer open');
    const {steps, effects} = restoreEffects(failed);

    await expect(askRestoreRevision(confirm, path, source, effects)).resolves.toBeUndefined();

    expect(steps).toEqual(['close', `land ${source} at ${path}`]);
    expect(warn).toHaveBeenCalledWith('inkling: could not ask about restoring a revision', failed);
  });
});

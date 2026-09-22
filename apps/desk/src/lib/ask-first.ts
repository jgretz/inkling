import {isUnder, type DocPath, type DocSummary, type GroupPath} from '@inkling/vault';
import type {Conversation} from './conversations.ts';
import {docDeletePrompt, groupDeletePrompt} from './deletion.ts';

/**
 * The commands that ask before they destroy or overwrite something.
 *
 * The dialog is a parameter rather than an import of Tauri's `confirm`, for the
 * reason the token reader's primitives are: bun's module-mock registry is
 * global to a run, so the only safe way for a test to answer the dialog is to
 * hand one in. What is left here is the part a regression would break silently:
 * whether the question is asked, what it says, and that nothing runs unless the
 * writer said yes.
 *
 * Every export resolves rather than rejects. A dialog that fails, or an action
 * that throws after a yes, is logged and swallowed, since the caller fires these
 * from a click handler with nothing to hand an error to.
 */

/** The yes/no dialog, as a value. Tauri's `confirm` is one; a test passes a stub. */
export type Confirm = (
  message: string,
  options: {title: string; kind: 'warning'},
) => Promise<boolean>;

/** Asks, and runs `act` only on a yes. One helper so the four cannot disagree. */
async function askFirst(
  confirm: Confirm,
  message: string,
  title: string,
  act: () => unknown,
  failure: string,
): Promise<void> {
  try {
    if (await confirm(message, {title, kind: 'warning'})) await act();
  } catch (error) {
    console.warn(`inkling: ${failure}`, error);
  }
}

/**
 * Asked before rather than undone after: a conversation takes every turn of it
 * through the table's cascade, and the prose either side of a session is the
 * part of this that cannot be recovered.
 */
export function askDeleteConversation(
  confirm: Confirm,
  doomed: Pick<Conversation, 'id' | 'title'> | undefined,
  remove: (id: number) => void,
): Promise<void> {
  if (doomed === undefined) return Promise.resolve();
  return askFirst(
    confirm,
    `Delete "${doomed.title}" and everything said in it?`,
    'Delete conversation',
    function () {
      remove(doomed.id);
    },
    'could not ask about deleting a conversation',
  );
}

/**
 * Asked before rather than undone after, for the reason deleting a
 * conversation is: the file has the Trash to come back from, and what inkling
 * stored about it has nothing at all. Neither this nor deleting a group can be
 * turned off: there is no setting, no prop and no environment check between the
 * click and the question.
 */
export function askDeleteDoc(
  confirm: Confirm,
  docs: readonly DocSummary[],
  path: DocPath,
  deleteDoc: (path: DocPath) => void,
): Promise<void> {
  const doomed = docs.find(function (doc) {
    return doc.path === path;
  });
  return askFirst(
    confirm,
    docDeletePrompt(doomed?.title ?? path),
    'Delete document',
    function () {
      deleteDoc(path);
    },
    'could not ask about deleting a document',
  );
}

/** Asked before a group goes, counting what goes with it. */
export function askDeleteGroup(
  confirm: Confirm,
  docs: readonly DocSummary[],
  group: GroupPath,
  deleteGroup: (group: GroupPath) => void,
): Promise<void> {
  // Everything under it, however deep, because that is what goes.
  const count = docs.filter(function (doc) {
    return isUnder(doc.path, group);
  }).length;
  return askFirst(
    confirm,
    groupDeletePrompt(group, count),
    'Delete group',
    function () {
      deleteGroup(group);
    },
    'could not ask about deleting a group',
  );
}

/** What restoring does once the writer agrees, in the order it does it. */
export type RestoreEffects = {
  close: () => void;
  land: (source: string, path: DocPath) => Promise<void>;
};

/**
 * Asked before rather than undone after, the way deleting a conversation is:
 * the draft on screen may hold work the writer has not thought about losing,
 * and this replaces the whole document with the older one.
 *
 * `land` rather than a second write path: it writes, reads the file back, and
 * refuses when the path is no longer the open document, which is exactly what
 * restoring wants.
 */
export function askRestoreRevision(
  confirm: Confirm,
  path: DocPath | undefined,
  source: string,
  effects: RestoreEffects,
): Promise<void> {
  if (path === undefined) return Promise.resolve();
  return askFirst(
    confirm,
    `Replace ${path} with this revision? What is in the editor now is overwritten.`,
    'Restore revision',
    function () {
      effects.close();
      return effects.land(source, path);
    },
    'could not ask about restoring a revision',
  );
}

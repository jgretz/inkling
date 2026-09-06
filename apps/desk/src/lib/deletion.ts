/**
 * What the writer is asked before a delete.
 *
 * Pure strings in their own module, with no import of `bridge.ts`, for the
 * reason every count in a sentence gets one: the plural and the number are the
 * part that breaks silently, and a test can only pin them if they are not
 * tangled up in a dialog.
 *
 * Every prompt says the same two things, because both are true and only one of
 * them is obvious. The file goes to the Trash, so the prose has a way back. What
 * inkling stored about it does not: a document dragged back out comes back as
 * prose with none of its dismissals, references, revisions or conversations.
 * Even a group holding no documents has the second half to say, because a
 * reference attached to the group itself is swept with it.
 */

/** The part a prompt ends with, since it is the half that cannot be undone. */
const KEPT_NOTHING =
  'What inkling stored (dismissed findings, references, kept revisions and conversations) is not kept.';

/** Asks about one document, named by its title rather than its path. */
export function docDeletePrompt(title: string): string {
  return `Delete "${title}"? The file goes to the Trash. ${KEPT_NOTHING}`;
}

/**
 * Asks about a group, counting what goes with it.
 *
 * The count is the whole point of the sentence: a folded group can hold work
 * the writer cannot see from the row they clicked, and a nested group's
 * documents are counted too because they go as well.
 *
 * A group holding none still says what is not kept, because a reference
 * attached to the group is swept whether or not a document was there to inherit
 * it, and it is the row a writer is likeliest to have forgotten.
 */
export function groupDeletePrompt(name: string, count: number): string {
  if (count === 0) {
    return `Delete the group "${name}"? It holds no documents. The folder goes to the Trash. ${KEPT_NOTHING}`;
  }
  const documents = count === 1 ? '1 document' : `${count} documents`;
  return `Delete the group "${name}" and the ${documents} inside it? Everything goes to the Trash. ${KEPT_NOTHING}`;
}

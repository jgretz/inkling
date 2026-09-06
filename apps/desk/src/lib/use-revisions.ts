import {useCallback, useEffect, useState} from 'react';
import type {DocPath} from '@inkling/vault';
import type {Revision, RevisionStore, RevisionSummary} from './revisions.ts';

/**
 * The open document's revisions, and the two gestures over them.
 *
 * Shaped like `use-conversations.ts`: state so the panel reacts to a click
 * rather than to a round trip, the injected store so nothing here names
 * `bridge.ts`, and a vault whose database will not open leaving this empty with
 * every action a no-op. That is the same degradation `dataNotice` explains in
 * the status bar.
 *
 * Unlike the conversations, a document with none gets nothing created for it. A
 * revision is only ever taken because the writer asked for one, so a document
 * nobody has snapshotted holds no rows at all.
 */

export type Revisions = {
  /** Every revision of the open document, newest first. */
  all: readonly RevisionSummary[];
  /**
   * Keeps the source as the next revision, resolving to the row it created, or
   * to undefined when there is nowhere to put it.
   *
   * Rejects when the write itself failed, so the caller can say so on screen.
   */
  snapshot: (source: string) => Promise<RevisionSummary | undefined>;
  /** One revision's text, or undefined when it could not be read. */
  read: (id: number) => Promise<Revision | undefined>;
};

type Options = {
  store: RevisionStore;
  /** The open document, which owns its revisions. */
  docPath: DocPath | undefined;
  /** Whether the vault database is open. */
  ready: boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRevisions({store, docPath, ready}: Options): Revisions {
  const [all, setAll] = useState<readonly RevisionSummary[]>([]);

  useEffect(
    function () {
      // Emptied first: without this, one document's revisions would be on
      // screen for the next one for as long as the read took, and restoring one
      // of them would write another document's prose into this one.
      setAll([]);
      if (docPath === undefined || !ready) return;

      let live = true;
      store
        .list(docPath)
        .then(function (rows) {
          if (live) setAll(rows);
        })
        .catch(function (error) {
          console.warn(`inkling: could not read the revisions of ${docPath}`, error);
        });
      return function () {
        live = false;
      };
    },
    [store, docPath, ready],
  );

  const snapshot = useCallback(
    async function (source: string) {
      if (docPath === undefined || !ready) return undefined;
      try {
        const kept = await store.create(docPath, source);
        // Prepended rather than re-listed: the list is newest first and this is
        // the newest, so a second round trip would only confirm what came back.
        setAll(function (current) {
          return [kept, ...current];
        });
        return kept;
      } catch (error) {
        console.warn(`inkling: could not keep a revision of ${docPath}`, error);
        throw new Error(`could not save a revision: ${message(error)}`, {cause: error});
      }
    },
    [store, docPath, ready],
  );

  const read = useCallback(
    async function (id: number) {
      if (!ready) return undefined;
      try {
        return await store.read(id);
      } catch (error) {
        console.warn(`inkling: could not read revision ${id}`, error);
        return undefined;
      }
    },
    [store, ready],
  );

  return {all, snapshot, read};
}

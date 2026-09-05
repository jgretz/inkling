import {useCallback, useEffect, useRef, useState} from 'react';
import {groupOf, templateFor, type DocPath, type VaultPath} from '@inkling/vault';
import {
  addReference,
  addReferenceSuppression,
  createDoc,
  listReferences,
  listReferenceSuppressions,
  removeReference,
  removeReferenceSuppression,
  type StoredReference,
  type StoredReferenceSuppression,
} from './bridge.ts';
import {notePathFor, type ContextReference, type ReferenceKind} from './references.ts';

/** What the picker hands back: a kind, a target, and which level owns it. */
export type AttachRequest = {
  level: 'document' | 'group';
  kind: ReferenceKind;
  title: string;
  /** The vault document a `doc` reference names. */
  targetPath?: DocPath;
  /** The address a `link` reference names. */
  url?: string;
};

export type References = {
  /** Every reference in the vault; the cascade is assembled from these. */
  rows: readonly StoredReference[];
  /** Every inherited reference some document turned off. */
  suppressions: readonly StoredReferenceSuppression[];
  attach: (request: AttachRequest) => void;
  /** Deletes a reference the open document owns. */
  detach: (entry: ContextReference) => void;
  /** Turns an inherited reference off for the open document, keeping the group's row. */
  suppress: (entry: ContextReference) => void;
  restore: (entry: ContextReference) => void;
};

type Options = {
  vault: VaultPath | undefined;
  /** The open document, which owns an attachment and any suppression. */
  docPath: DocPath | undefined;
  ready: boolean;
  /**
   * Every document path in the vault, so a new note's filename is unique.
   *
   * Also what the rows are re-read on. A new list means the vault was scanned
   * again, and a scan follows a rename inside inkling, which is exactly when the
   * paths these rows store have moved underneath them.
   */
  taken: readonly DocPath[];
  /** Rescan the vault, so a note just written appears in the library. */
  onNoteWritten: () => void;
};

/**
 * The vault's references, held in state so the strip reacts to a click rather
 * than to a round trip.
 *
 * The whole table is loaded at once rather than per document: a vault holds
 * tens of these, and the ancestor walk that decides which of them reach the
 * open document is a pure function over the rows. That is also why the rows
 * reload on the vault rather than on the open document.
 *
 * Every write goes to the database and updates the state from what came back,
 * so the id a detach needs is the one the database actually assigned. A vault
 * whose database will not open leaves this empty and every attachment a no-op,
 * which is the same degradation `dataNotice` explains in the status bar.
 */
export function useReferences({vault, docPath, ready, taken, onNoteWritten}: Options): References {
  const [rows, setRows] = useState<readonly StoredReference[]>([]);
  const [suppressions, setSuppressions] = useState<readonly StoredReferenceSuppression[]>([]);

  useEffect(
    function () {
      // Emptied first: without this, one vault's references would apply to the
      // next one for as long as the read took.
      setRows([]);
      setSuppressions([]);
      if (vault === undefined || !ready) return;

      let live = true;
      // One round trip's latency rather than two: neither read needs the other.
      Promise.all([listReferences(), listReferenceSuppressions()])
        .then(function ([stored, off]) {
          if (!live) return;
          setRows(stored);
          setSuppressions(off);
        })
        .catch(function (error) {
          console.warn('inkling: could not read the vault references', error);
        });
      return function () {
        live = false;
      };
    },
    [vault, ready, taken],
  );

  // Held in refs, the way `useWorkspace` holds its sources: depending on the
  // list itself would give `attach` a new identity after every vault scan and
  // re-render the strip on every keystroke elsewhere.
  const takenRef = useRef(taken);
  takenRef.current = taken;
  const notifyRef = useRef(onNoteWritten);
  notifyRef.current = onNoteWritten;

  /** Replaces by id, so re-attaching something already there does not duplicate it. */
  const remember = useCallback(function (row: StoredReference) {
    setRows(function (current) {
      return [
        ...current.filter(function (entry) {
          return entry.id !== row.id;
        }),
        row,
      ];
    });
  }, []);

  const attach = useCallback(
    function (request: AttachRequest) {
      if (vault === undefined || docPath === undefined || !ready) return;
      const group = groupOf(docPath);
      if (request.level === 'group' && group === undefined) return;
      const owner =
        request.level === 'group' && group !== undefined
          ? ({kind: 'group', path: group} as const)
          : ({kind: 'doc', path: docPath} as const);

      const attaching =
        request.kind === 'note'
          ? // A note's body is an ordinary vault document, written before the
            // row that points at it: a reference to a file that is not there
            // would render as broken the moment it was attached.
            (function () {
              const path = notePathFor(request.title, new Set(takenRef.current));
              return createDoc(
                vault,
                path,
                templateFor('note', request.title, new Date().toISOString()),
              ).then(function () {
                notifyRef.current();
                return addReference({owner, kind: 'note', title: request.title, targetPath: path});
              });
            })()
          : addReference({
              owner,
              kind: request.kind,
              title: request.title,
              targetPath: request.targetPath,
              url: request.url,
            });

      attaching.then(remember).catch(function (error) {
        console.warn(`inkling: could not attach ${request.title}`, error);
      });
    },
    [vault, docPath, ready, remember],
  );

  const detach = useCallback(
    function (entry: ContextReference) {
      if (!ready) return;
      removeReference(entry.id)
        .then(function () {
          setRows(function (current) {
            return current.filter(function (row) {
              return row.id !== entry.id;
            });
          });
          // The database cascades the suppressions filed against it; the state
          // has to drop them too or a restore would call on a row that is gone.
          setSuppressions(function (current) {
            return current.filter(function (row) {
              return row.referenceId !== entry.id;
            });
          });
        })
        .catch(function (error) {
          console.warn(`inkling: could not detach ${entry.title}`, error);
        });
    },
    [ready],
  );

  const suppress = useCallback(
    function (entry: ContextReference) {
      if (docPath === undefined || !ready) return;
      addReferenceSuppression(docPath, entry.id)
        .then(function (row) {
          setSuppressions(function (current) {
            return [
              ...current.filter(function (existing) {
                return existing.id !== row.id;
              }),
              row,
            ];
          });
        })
        .catch(function (error) {
          console.warn(`inkling: could not turn off ${entry.title}`, error);
        });
    },
    [docPath, ready],
  );

  const restore = useCallback(
    function (entry: ContextReference) {
      const id = entry.suppressedBy;
      if (id === undefined || !ready) return;
      removeReferenceSuppression(id)
        .then(function () {
          setSuppressions(function (current) {
            return current.filter(function (row) {
              return row.id !== id;
            });
          });
        })
        .catch(function (error) {
          console.warn(`inkling: could not restore ${entry.title}`, error);
        });
    },
    [ready],
  );

  return {rows, suppressions, attach, detach, suppress, restore};
}

import {useCallback, useEffect, useRef, useState} from 'react';
import {groupOf, templateFor, type DocPath, type VaultPath} from '@inkling/vault';
import {
  addLinks,
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
import type {PastedLink} from './link-paste.ts';
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

/** What the paste field hands back: every link it found, and which level owns them. */
export type BulkAttachRequest = {
  level: 'document' | 'group';
  links: readonly PastedLink[];
  /** Non-blank lines the extractor found no link in, carried through to the confirmation. */
  ignoredLines: number;
};

/** How a paste landed, which is what the status bar says out loud. */
export type BulkAttachResult = {attached: number; skipped: number};

/**
 * Which of the two owner columns a level means, or nothing when the level
 * cannot be honoured: a document at the vault root has no group above it.
 */
function ownerFor(docPath: DocPath, level: 'document' | 'group') {
  if (level === 'document') return {kind: 'doc', path: docPath} as const;
  const group = groupOf(docPath);
  return group === undefined ? undefined : ({kind: 'group', path: group} as const);
}

export type References = {
  /** Every reference in the vault; the cascade is assembled from these. */
  rows: readonly StoredReference[];
  /** Every inherited reference some document turned off. */
  suppressions: readonly StoredReferenceSuppression[];
  attach: (request: AttachRequest) => void;
  /**
   * Attaches a whole paste of links in one write, resolving to how many landed
   * and how many were already there.
   *
   * Unlike `attach`, this one rejects rather than returning: the writer's paste
   * is still in the field and the caller has to decide whether to clear it.
   */
  attachMany: (request: BulkAttachRequest) => Promise<BulkAttachResult>;
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

  /**
   * Folds written rows into the list, replacing by id.
   *
   * By id rather than by appending, because both writes read the row back
   * whether or not they created it: re-attaching something already there must
   * not show up twice in the strip.
   */
  const rememberAll = useCallback(function (written: readonly StoredReference[]) {
    if (written.length === 0) return;
    setRows(function (current) {
      const ids = new Set(
        written.map(function (row) {
          return row.id;
        }),
      );
      return [
        ...current.filter(function (entry) {
          return !ids.has(entry.id);
        }),
        ...written,
      ];
    });
  }, []);

  const remember = useCallback(
    function (row: StoredReference) {
      rememberAll([row]);
    },
    [rememberAll],
  );

  const attach = useCallback(
    function (request: AttachRequest) {
      if (vault === undefined || docPath === undefined || !ready) return;
      const owner = ownerFor(docPath, request.level);
      if (owner === undefined) return;

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

  /**
   * A whole paste, in one round trip.
   *
   * Both halves of what comes back are folded into the rows: a link that was
   * already there is not news, but a link the *group* already held is about to
   * appear in the strip for the first time, and dropping it would leave the
   * chips disagreeing with the confirmation until the next vault scan.
   *
   * Rejects rather than returning quietly, unlike `attach`. The paste is still
   * in the writer's field and the field decides whether to clear it.
   */
  const attachMany = useCallback(
    function (request: BulkAttachRequest): Promise<BulkAttachResult> {
      if (vault === undefined || docPath === undefined || !ready) {
        return Promise.reject(new Error('there is nowhere to attach these links yet'));
      }
      const owner = ownerFor(docPath, request.level);
      if (owner === undefined) {
        return Promise.reject(new Error('this document is not in a group'));
      }

      return addLinks(owner, request.links).then(function (landed) {
        rememberAll([...landed.attached, ...landed.skipped]);
        return {attached: landed.attached.length, skipped: landed.skipped.length};
      });
    },
    [vault, docPath, ready, rememberAll],
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

  return {rows, suppressions, attach, attachMany, detach, suppress, restore};
}

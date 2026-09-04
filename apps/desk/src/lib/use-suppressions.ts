import {useCallback, useEffect, useState} from 'react';
import type {DocPath} from '@inkling/vault';
import type {Finding} from '@inkling/voice';
import {addSuppression, listSuppressions, removeSuppression} from './bridge.ts';
import {dismissalOf, type Dismissal} from './voice-rules.ts';

export type Suppressions = {
  /** What the writer dismissed in the open document. */
  dismissals: readonly Dismissal[];
  dismiss: (finding: Finding) => void;
  restore: (id: number) => void;
};

/**
 * The open document's dismissed findings, held in state so the strip reacts to
 * a click rather than to a round trip.
 *
 * The rows are reloaded whenever the open document changes, and the state is
 * emptied first: without that, one document's dismissals would apply to the
 * next one for as long as the read took. Every write goes to the database and
 * updates the state from what came back, so the id a restore needs is the one
 * the database actually assigned.
 *
 * A vault whose database will not open leaves this empty and every dismissal a
 * no-op. That is the same degradation `dataNotice` explains in the status bar:
 * the writing still works, only what inkling stores beside it is missing.
 */
export function useSuppressions(docPath: DocPath | undefined, ready: boolean): Suppressions {
  const [dismissals, setDismissals] = useState<readonly Dismissal[]>([]);

  useEffect(
    function () {
      setDismissals([]);
      if (docPath === undefined || !ready) return;

      let live = true;
      listSuppressions(docPath)
        .then(function (rows) {
          if (live) setDismissals(rows.map(dismissalOf));
        })
        .catch(function (error) {
          console.warn(`inkling: could not read dismissals for ${docPath}`, error);
        });
      return function () {
        live = false;
      };
    },
    [docPath, ready],
  );

  const dismiss = useCallback(
    function (finding: Finding) {
      if (docPath === undefined || !ready) return;
      addSuppression(docPath, finding.ruleId, finding.anchor)
        .then(function (row) {
          const dismissal = dismissalOf(row);
          setDismissals(function (current) {
            // Dismissing the same finding twice returns the row that already
            // held it, so the list is replaced by id rather than appended to.
            return [
              ...current.filter(function (entry) {
                return entry.id !== dismissal.id;
              }),
              dismissal,
            ];
          });
        })
        .catch(function (error) {
          console.warn(`inkling: could not dismiss a ${finding.ruleId} finding`, error);
        });
    },
    [docPath, ready],
  );

  const restore = useCallback(
    function (id: number) {
      if (!ready) return;
      removeSuppression(id)
        .then(function () {
          setDismissals(function (current) {
            return current.filter(function (entry) {
              return entry.id !== id;
            });
          });
        })
        .catch(function (error) {
          console.warn(`inkling: could not restore dismissal ${id}`, error);
        });
    },
    [ready],
  );

  return {dismissals, dismiss, restore};
}

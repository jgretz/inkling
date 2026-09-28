import {useCallback, useState} from 'react';
import type {Range} from '@inkling/voice';
import {leaveRead, type ModeState} from '../../lib/doc-mode.ts';
import type {Reveal} from '../editor/EditorPanel.tsx';

/** A mode update as a function of the state it replaces, the shape a state setter takes. */
export type ModeUpdate = (update: (state: ModeState) => ModeState) => void;

/**
 * The one path by which anything asks the editor to show a range.
 *
 * A range is only visible in the editor, so asking for one leaves Read first,
 * for whichever editing mode the writer was last in.
 * Both are set in the same handler, and React batches them into one render, so
 * the editor is shown and handed the request in a single commit: it is visible
 * before its reveal effect scrolls and before the focus that follows it.
 *
 * The counter increments on every request because the editor honours one reveal
 * per counter value. Without it, picking the same finding twice would be the
 * same request and the second click would move nothing.
 */
export function useReveal(updateMode: ModeUpdate) {
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined);

  const show = useCallback(
    function (range: Range, mark?: boolean) {
      updateMode(leaveRead);
      setReveal(function (current) {
        return {range, seq: (current?.seq ?? 0) + 1, mark};
      });
    },
    [updateMode],
  );

  return {reveal, show};
}

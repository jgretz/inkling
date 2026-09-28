import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';

type DialogProps = {
  /** Names the dialog for a screen reader. */
  label: string;
  onClose: () => void;
  /**
   * Where the caret goes when this closes, when that is not whatever had it
   * when this opened. A dialog raised from a menu opens with the caret on a menu
   * item that is gone by the time it closes, so the caller names the control
   * behind the menu instead.
   */
  returnFocus?: HTMLElement;
  /** Sizes the box. The overlay around it is the same for every dialog. */
  className?: string;
  children: ReactNode;
};

/**
 * Everything inside the dialog a Tab can land on, in document order.
 *
 * `disabled` is excluded because a control that does nothing yet, like a
 * Restore with no revision on screen, would strand the caret if the trap
 * wrapped onto it.
 */
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * A modal over the three panels: opened to answer one question and closed
 * again.
 *
 * The interaction rules are `DocMenu`'s: listeners exist only while it is open,
 * Escape closes, and a click outside closes. Focus moves in on open, wraps
 * within the dialog on Tab, and goes back on close: `aria-modal` tells a screen
 * reader the rest of the window is out of play, and a caret that could walk out
 * into it would make that a lie.
 *
 * The first field is marked `data-autofocus` rather than `autoFocus`. React
 * focuses an `autoFocus` element before this component's effect runs, so the
 * opener captured below would be the field itself and the caret would have
 * nowhere to go back to.
 */
export function Dialog({label, onClose, returnFocus, className = '', children}: DialogProps) {
  const root = useRef<HTMLDivElement>(null);
  // Read once, on close. A caller re-rendering with another element mid-dialog
  // has not changed who opened it.
  const back = useRef(returnFocus);

  useEffect(
    function () {
      function handleDown(event: MouseEvent) {
        const target = event.target;
        if (target instanceof Node && root.current?.contains(target) === true) return;
        onClose();
      }
      function handleKey(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        // Wrapped rather than left to the browser: the three panels behind this
        // are still in the tab order, and `aria-modal` has already told a screen
        // reader they are not there to be reached.
        const stops = root.current === null ? [] : focusable(root.current);
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (first === undefined || last === undefined) return;

        const at = stops.findIndex(function (stop) {
          return stop === document.activeElement;
        });
        const leaving = event.shiftKey ? at === 0 : at === stops.length - 1;
        // Off the list entirely means the caret is on the dialog itself, which
        // is where it starts, so Tab enters rather than wraps.
        if (at !== -1 && !leaving) return;

        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
      document.addEventListener('mousedown', handleDown);
      document.addEventListener('keydown', handleKey);
      return function () {
        document.removeEventListener('mousedown', handleDown);
        document.removeEventListener('keydown', handleKey);
      };
    },
    [onClose],
  );

  useEffect(function () {
    const opener = document.activeElement;
    const box = root.current;
    (box?.querySelector<HTMLElement>('[data-autofocus]') ?? box)?.focus();
    return function () {
      // Only when the caret would otherwise be left nowhere. A click that landed
      // elsewhere in the window is what closed this, and it already holds the
      // focus; taking it back would fight the writer over where they just went.
      const after = document.activeElement;
      const lost = after === null || after === document.body || box?.contains(after) === true;
      if (!lost) return;
      const target = back.current?.isConnected === true ? back.current : opener;
      if (target instanceof HTMLElement) target.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink-950/70 p-10">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`animate-dialog-in rounded-lg border border-ink-800 bg-ink-900 shadow-lg focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

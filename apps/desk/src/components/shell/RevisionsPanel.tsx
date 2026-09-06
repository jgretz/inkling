import {useCallback, useEffect, useRef, useState} from 'react';
import type {Revision, RevisionSummary} from '../../lib/revisions.ts';
import {relativeTime} from '../library/DocRow.tsx';

type RevisionsPanelProps = {
  /** Every revision of the open document, newest first. */
  revisions: readonly RevisionSummary[];
  /** The open document, named so the panel says what these are revisions of. */
  docPath: string;
  /**
   * Fetches one revision's text. The list carries none of it.
   *
   * Resolves to undefined rather than rejecting when the read failed, so the
   * panel has one shape to render for "not read yet" and "could not be read".
   */
  onRead: (id: number) => Promise<Revision | undefined>;
  /** Writes the shown revision over the live document. The caller confirms first. */
  onRestore: (source: string) => void;
  onClose: () => void;
};

/**
 * The exact moment, for a writer choosing between two revisions minutes apart.
 *
 * Falls back to the stored string rather than to `Invalid Date`: a timestamp
 * this cannot parse is still the only thing that tells two revisions apart.
 */
function absoluteTime(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString();
}

/**
 * Everything inside the dialog a Tab can land on, in document order.
 *
 * `disabled` is excluded because Restore is disabled until a revision is on
 * screen, and a trap that wrapped onto it would strand the caret on a control
 * that does nothing.
 */
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
}

/**
 * Reading a kept revision back, and putting one over the live document.
 *
 * An overlay rather than a fourth panel: this is opened to answer one question
 * and closed again, and the three panels are what the writer works in. There is
 * no modal precedent in the app, so the interaction rules are `DocMenu`'s:
 * listeners exist only while it is open, Escape closes, and a click outside
 * closes. Focus moves in on open, wraps within the dialog on Tab, and goes back
 * to whatever had it on close: `aria-modal` tells a screen reader the rest of
 * the window is out of play, and a caret that could walk out into it would make
 * that a lie.
 *
 * Restoring is the caller's to confirm. This panel knows which revision is on
 * screen; only `App.tsx` knows that the draft about to be overwritten may hold
 * an hour of unsaved work.
 */
export function RevisionsPanel({
  revisions,
  docPath,
  onRead,
  onRestore,
  onClose,
}: RevisionsPanelProps) {
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [shown, setShown] = useState<Revision | undefined>(undefined);
  const [shownFor, setShownFor] = useState(docPath);
  const root = useRef<HTMLDivElement>(null);

  // A revision picked in one document must not stay on screen, or stay
  // restorable, once the panel is showing another document's revisions: putting
  // it back would write one document's prose into a different file. Cleared
  // during the render that changes `docPath` rather than in an effect after it,
  // so the old prose is never painted under the new document's name.
  if (docPath !== shownFor) {
    setShownFor(docPath);
    setSelectedId(undefined);
    setShown(undefined);
  }

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
    // Whoever opened this gets the caret back when it goes, rather than being
    // dropped at the top of the window with nothing focused.
    const opener = document.activeElement;
    root.current?.focus();
    return function () {
      // Only when the caret would otherwise be left nowhere. A click that landed
      // elsewhere in the window is what closed this, and it already holds the
      // focus; taking it back would fight the writer over where they just went.
      const after = document.activeElement;
      if (after !== null && after !== document.body) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(
    function () {
      // Emptied first, so the previous revision's prose is never on screen under
      // the newly picked one's date while the read is in flight.
      setShown(undefined);
      if (selectedId === undefined) return;

      let live = true;
      void onRead(selectedId).then(function (revision) {
        if (live) setShown(revision);
      });
      return function () {
        live = false;
      };
    },
    [selectedId, onRead],
  );

  const handleRestore = useCallback(
    function () {
      if (shown === undefined) return;
      onRestore(shown.source);
    },
    [shown, onRestore],
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink-950/70 p-10">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={`Revisions of ${docPath}`}
        tabIndex={-1}
        className="flex h-full max-h-[34rem] w-full max-w-3xl overflow-hidden rounded-lg border border-ink-800 bg-ink-900 shadow-lg focus:outline-none"
      >
        <div className="flex w-56 shrink-0 flex-col border-r border-ink-800">
          <h2 className="px-3 py-3 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            Revisions
          </h2>
          {revisions.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-ink-600">No revisions of this document yet.</p>
          ) : (
            <ul className="flex-1 overflow-y-auto px-2 pb-3">
              {revisions.map(function (revision) {
                return (
                  <li key={revision.id}>
                    <button
                      type="button"
                      onClick={function () {
                        setSelectedId(revision.id);
                      }}
                      aria-current={revision.id === selectedId ? 'true' : undefined}
                      className={`block w-full rounded px-2 py-1.5 text-left transition-colors duration-100 ${
                        revision.id === selectedId
                          ? 'bg-ink-800 text-ink-100'
                          : 'text-ink-200 hover:bg-ink-800'
                      }`}
                    >
                      <span className="block text-[12px]">{relativeTime(revision.createdAt)}</span>
                      <span className="block text-[11px] text-ink-500">
                        {absoluteTime(revision.createdAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-400">{docPath}</span>
            <button
              type="button"
              onClick={handleRestore}
              disabled={shown === undefined}
              className="rounded-md px-2 py-1 text-[12px] text-ink-200 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-[12px] text-ink-400 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
            >
              Close
            </button>
          </div>

          {shown === undefined ? (
            <p className="px-3 py-3 text-[12px] text-ink-600">
              {revisions.length === 0
                ? 'Save a revision from the document menu to keep one.'
                : 'Pick a revision to read it.'}
            </p>
          ) : (
            <pre className="selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-3 text-[12px] leading-relaxed text-ink-200">
              {shown.source}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

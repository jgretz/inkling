import {useCallback, useEffect, useRef, useState} from 'react';
import type {Revision, RevisionSummary} from '../../lib/revisions.ts';
import {relativeTime} from '../library/DocRow.tsx';

type RevisionsPanelProps = {
  /** Every revision of the open document, newest first. */
  revisions: readonly RevisionSummary[];
  /** The open document, named so the panel says what these are revisions of. */
  docPath: string;
  /** Fetches one revision's text. The list carries none of it. */
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
 * Reading a kept revision back, and putting one over the live document.
 *
 * An overlay rather than a fourth panel: this is opened to answer one question
 * and closed again, and the three panels are what the writer works in. There is
 * no modal precedent in the app, so the interaction rules are `DocMenu`'s:
 * listeners exist only while it is open, Escape closes, and a click outside
 * closes.
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
  const root = useRef<HTMLDivElement>(null);

  useEffect(
    function () {
      function handleDown(event: MouseEvent) {
        const target = event.target;
        if (target instanceof Node && root.current?.contains(target) === true) return;
        onClose();
      }
      function handleKey(event: KeyboardEvent) {
        if (event.key === 'Escape') onClose();
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
        className="flex h-full max-h-[34rem] w-full max-w-3xl overflow-hidden rounded-lg border border-ink-800 bg-ink-900 shadow-lg"
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

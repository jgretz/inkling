import {useCallback, useEffect, useRef, useState} from 'react';
import FileOutput from 'lucide-react/dist/esm/icons/file-output';
import type {FrontmatterChoice} from '../../lib/export.ts';

type DocMenuProps = {
  /** Writes the open document to a file the writer picks. */
  onExport: (choice: FrontmatterChoice) => void;
  /** Puts the open document on the clipboard as HTML and plain text at once. */
  onCopy: () => void;
  /** True when no document is open, so there is nothing to give anyone. */
  disabled: boolean;
};

const ITEM =
  'block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-200 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-100';

/**
 * The document's two ways out: a file on disk and the clipboard.
 *
 * A menu rather than three buttons in the bar, because these are the finishing
 * gestures and they are used once a piece is done, not while it is being
 * written. The frontmatter choice is two items rather than a dialog: it is the
 * whole decision, and a modal to hold one either/or would cost more than it
 * settles.
 */
export function DocMenu({onExport, onCopy, disabled}: DocMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = useCallback(function () {
    setOpen(false);
  }, []);

  const toggle = useCallback(function () {
    setOpen(function (current) {
      return !current;
    });
  }, []);

  // Listeners exist only while the panel is open, so a closed menu costs the
  // window nothing.
  useEffect(
    function () {
      if (!open) return;
      function handleDown(event: MouseEvent) {
        const target = event.target;
        if (target instanceof Node && root.current?.contains(target) === true) return;
        setOpen(false);
      }
      function handleKey(event: KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false);
      }
      document.addEventListener('mousedown', handleDown);
      document.addEventListener('keydown', handleKey);
      return function () {
        document.removeEventListener('mousedown', handleDown);
        document.removeEventListener('keydown', handleKey);
      };
    },
    [open],
  );

  const handleKeep = useCallback(
    function () {
      close();
      onExport('keep');
    },
    [close, onExport],
  );

  const handleStrip = useCallback(
    function () {
      close();
      onExport('strip');
    },
    [close, onExport],
  );

  const handleCopy = useCallback(
    function () {
      close();
      onCopy();
    },
    [close, onCopy],
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Document actions"
        title="Document actions"
        className={`rounded-md p-1.5 transition-colors duration-100 disabled:opacity-30 ${
          open ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
        }`}
      >
        <FileOutput size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-ink-800 bg-ink-900 p-1 shadow-lg"
        >
          <button type="button" role="menuitem" onClick={handleKeep} className={ITEM}>
            Export…
          </button>
          <button type="button" role="menuitem" onClick={handleStrip} className={ITEM}>
            Export without frontmatter…
          </button>
          <button type="button" role="menuitem" onClick={handleCopy} className={ITEM}>
            Copy as rich text
          </button>
        </div>
      )}
    </div>
  );
}

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {MenuItem} from './library-actions.ts';

type ActionMenuProps = {
  /** Names the menu for a screen reader. */
  label: string;
  items: readonly MenuItem[];
  /** Viewport coordinates of the menu's top-left corner, before it is clamped. */
  at: {x: number; y: number};
  /** The control that raised the menu, which gets the caret back when it closes. */
  trigger: HTMLElement;
  onSelect: (item: MenuItem) => void;
  onClose: () => void;
};

/** Keeps a menu this far inside the window's edges. */
const MARGIN = 4;

const ITEM =
  'block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-200 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-100 focus:bg-ink-800 focus:text-ink-100 focus:outline-none';

/**
 * The library's row menu.
 *
 * Fixed to the viewport rather than absolute inside the row: the tree scrolls,
 * and a menu positioned inside it would be clipped by it or would scroll it.
 * Being fixed, it would float away from its row once the tree moved, so a
 * scroll or a resize closes it instead.
 *
 * The rest follows `DocMenu`: listeners exist only while it is up, Escape and a
 * click outside close it. It adds what a menu opened from a row needs: the
 * first item takes the caret, the arrow keys, Home and End move it, and closing
 * hands it back to the ⋯ that raised the menu.
 */
export function ActionMenu({label, items, at, trigger, onSelect, onClose}: ActionMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(at);

  useLayoutEffect(
    function () {
      const box = root.current;
      if (box === null) return;
      const {width, height} = box.getBoundingClientRect();
      const x = Math.max(MARGIN, Math.min(at.x, window.innerWidth - width - MARGIN));
      // Opens upward rather than off the bottom of the window.
      const y =
        at.y + height > window.innerHeight - MARGIN ? Math.max(MARGIN, at.y - height) : at.y;
      setPlace({x, y});
    },
    [at.x, at.y],
  );

  useEffect(
    function () {
      function handleDown(event: MouseEvent) {
        const target = event.target;
        if (target instanceof Node && root.current?.contains(target) === true) return;
        // The ⋯ toggles its own menu on click, which follows this mousedown.
        // Closing here as well would have that click open it straight back up.
        if (target instanceof Node && trigger.contains(target)) return;
        onClose();
      }
      function handleKey(event: KeyboardEvent) {
        if (event.key === 'Escape') onClose();
      }
      document.addEventListener('mousedown', handleDown);
      document.addEventListener('keydown', handleKey);
      document.addEventListener('scroll', onClose, true);
      window.addEventListener('resize', onClose);
      return function () {
        document.removeEventListener('mousedown', handleDown);
        document.removeEventListener('keydown', handleKey);
        document.removeEventListener('scroll', onClose, true);
        window.removeEventListener('resize', onClose);
      };
    },
    [onClose, trigger],
  );

  useEffect(
    function () {
      const box = root.current;
      box?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      return function () {
        // Only when the caret went down with the menu. A click elsewhere that
        // closed it already put the caret where the writer wanted it.
        const after = document.activeElement;
        const lost = after === null || after === document.body || box?.contains(after) === true;
        if (lost && trigger.isConnected) trigger.focus();
      };
    },
    [trigger],
  );

  const handleKeyDown = useCallback(
    function (event: ReactKeyboardEvent<HTMLDivElement>) {
      const last = items.length - 1;
      const next = {
        ArrowDown: active === last ? 0 : active + 1,
        ArrowUp: active === 0 ? last : active - 1,
        Home: 0,
        End: last,
      }[event.key];
      if (event.key === 'Tab') {
        // A menu is one stop. Tab leaves it, from where its trigger is.
        onClose();
        return;
      }
      if (next === undefined) return;
      event.preventDefault();
      setActive(next);
      root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[next]?.focus();
    },
    [active, items.length, onClose],
  );

  return (
    <div
      ref={root}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      style={{left: place.x, top: place.y}}
      className="animate-menu-in fixed z-30 min-w-40 rounded-md border border-ink-800 bg-ink-900 p-1 shadow-lg"
    >
      {items.map(function (item, index) {
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            tabIndex={index === active ? 0 : -1}
            onClick={function () {
              onSelect(item);
            }}
            className={ITEM}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

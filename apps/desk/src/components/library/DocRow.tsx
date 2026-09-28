import {memo, useCallback, useMemo, useRef} from 'react';
import type {MouseEvent} from 'react';
import type {DocPath, DocSummary} from '@inkling/vault';
import type {Target} from './library-actions.ts';
import {MoreButton, type OpenMenu} from './MoreButton.tsx';

type DocRowProps = {
  doc: DocSummary;
  active: boolean;
  /** True while this row's own menu is up. */
  menuOpen: boolean;
  onOpen: (path: DocPath) => void;
  onMenu: OpenMenu;
};

/**
 * One document, as its title and nothing else.
 *
 * Everything that changes the document rather than opening it is behind the ⋯
 * or a right-click, so the gesture a writer makes all day shares its row with
 * nothing destructive.
 */
export const DocRow = memo(function DocRow({doc, active, menuOpen, onOpen, onMenu}: DocRowProps) {
  const more = useRef<HTMLButtonElement>(null);
  const target = useMemo(
    function (): Target {
      return {kind: 'doc', doc};
    },
    [doc],
  );

  const handleClick = useCallback(
    function () {
      onOpen(doc.path);
    },
    [doc.path, onOpen],
  );

  const handleContextMenu = useCallback(
    function (event: MouseEvent) {
      event.preventDefault();
      if (more.current !== null) onMenu(target, {x: event.clientX, y: event.clientY}, more.current);
    },
    [target, onMenu],
  );

  return (
    <div className="group/row relative" onContextMenu={handleContextMenu}>
      <button
        type="button"
        onClick={handleClick}
        aria-current={active ? 'true' : undefined}
        className={`block w-full truncate rounded-md px-2 py-1 text-left text-[13px] transition-colors duration-100 ${
          active ? 'bg-ink-700 text-ink-100' : 'text-ink-200 group-hover/row:bg-ink-800'
        }`}
      >
        {doc.title}
      </button>
      <MoreButton
        ref={more}
        label={`Actions for ${doc.title}`}
        target={target}
        shown={active || menuOpen}
        expanded={menuOpen}
        rowActive={active}
        onMenu={onMenu}
      />
    </div>
  );
});

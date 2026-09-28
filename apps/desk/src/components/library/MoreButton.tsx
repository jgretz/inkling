import {useCallback} from 'react';
import type {MouseEvent, Ref} from 'react';
import Ellipsis from 'lucide-react/dist/esm/icons/ellipsis';
import type {Target} from './library-actions.ts';

/**
 * Raises a row's menu. `at` is where a right-click landed; `undefined` means
 * the ⋯ itself was clicked, and the menu hangs under it.
 */
export type OpenMenu = (
  target: Target,
  at: {x: number; y: number} | undefined,
  trigger: HTMLElement,
) => void;

type MoreButtonProps = {
  ref: Ref<HTMLButtonElement>;
  label: string;
  target: Target;
  /** Visible without a hover: the row is the open document, or its menu is up. */
  shown: boolean;
  expanded: boolean;
  /** Matches the row's own background, so the ⋯ can sit over the title's end. */
  rowActive: boolean;
  onMenu: OpenMenu;
};

/**
 * The ⋯ on a library row.
 *
 * It overlays the row's right edge rather than taking a column of its own, so
 * at rest a title gets the whole width of a narrow panel, and it is drawn on
 * the row's own background so the end of a long title is covered rather than
 * showing through it.
 */
export function MoreButton({
  ref,
  label,
  target,
  shown,
  expanded,
  rowActive,
  onMenu,
}: MoreButtonProps) {
  const handleClick = useCallback(
    function (event: MouseEvent<HTMLButtonElement>) {
      onMenu(target, undefined, event.currentTarget);
    },
    [target, onMenu],
  );

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={handleClick}
      className={`absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-400 transition-opacity duration-100 hover:text-ink-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent-muted ${
        rowActive ? 'bg-ink-700' : 'bg-ink-800'
      } ${shown ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
    >
      <Ellipsis size={14} aria-hidden />
    </button>
  );
}

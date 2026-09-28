import {memo} from 'react';
import type {MouseEvent, ReactNode} from 'react';

type ToggleProps = {
  active: boolean;
  label: string;
  /** The hover, when it has more to say than the label. */
  hint?: string;
  onClick: () => void;
  /**
   * Whether pressing the button leaves focus where it was. A formatting button
   * needs this: the press would otherwise move focus, and the selection with it,
   * out of the editor before the command reads it.
   */
  holdFocus?: boolean;
  children: ReactNode;
};

/** One function for every button, so `memo` sees the same prop on every render. */
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

export const Toggle = memo(function Toggle({
  active,
  label,
  hint,
  onClick,
  holdFocus = false,
  children,
}: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={holdFocus ? keepFocus : undefined}
      aria-pressed={active}
      aria-label={label}
      title={hint ?? label}
      className={`rounded-md p-1.5 transition-colors duration-100 ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
});

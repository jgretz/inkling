import {memo} from 'react';
import type {ReactNode} from 'react';

type ToggleProps = {
  active: boolean;
  label: string;
  /** The hover, when it has more to say than the label. */
  hint?: string;
  onClick: () => void;
  children: ReactNode;
};

export const Toggle = memo(function Toggle({active, label, hint, onClick, children}: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
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

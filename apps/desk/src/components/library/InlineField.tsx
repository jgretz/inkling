import {useCallback, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent, KeyboardEvent} from 'react';

type InlineFieldProps = {
  /** Names the field for a screen reader, and says which thing is being named. */
  label: string;
  placeholder: string;
  /** Prefilled for a rename, empty for a create. */
  initial?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

/**
 * The one-line text input the library names things with: a new group, a renamed
 * group, a new document.
 *
 * A real input rather than `window.prompt`, which is not a thing a render test
 * can drive and not a thing a Tauri webview is obliged to show. Submitting an
 * empty value cancels, so the writer never has to reach for a second control to
 * back out of one they opened by accident.
 *
 * Three ways out, and clicking away is one of them. Enter commits, Escape
 * abandons, and losing focus commits the same as Enter, which is what Finder
 * does and what a writer who has already typed the name and moved on expects.
 * Without it the field is a trap: the only exits are two keys, neither of them
 * signposted, and a writer who clicks elsewhere is left looking at a field that
 * will not close.
 */
export function InlineField({
  label,
  placeholder,
  initial = '',
  onSubmit,
  onCancel,
}: InlineFieldProps) {
  const [value, setValue] = useState(initial);
  // Enter unmounts this field, and the DOM may fire `blur` on the way out.
  // Settling once keeps that from committing the same name twice.
  const settled = useRef(false);

  const settle = useCallback(
    function (next: string) {
      if (settled.current) return;
      settled.current = true;
      const trimmed = next.trim();
      if (trimmed.length === 0) onCancel();
      else onSubmit(trimmed);
    },
    [onSubmit, onCancel],
  );

  const handleChange = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      settle(value);
    },
    [value, settle],
  );

  const handleBlur = useCallback(
    function () {
      settle(value);
    },
    [value, settle],
  );

  const handleKeyDown = useCallback(
    function (event: KeyboardEvent<HTMLInputElement>) {
      if (event.key !== 'Escape') return;
      // Ahead of the blur this causes, so abandoning does not commit on the way
      // out.
      settled.current = true;
      onCancel();
    },
    [onCancel],
  );

  return (
    <form onSubmit={handleSubmit} className="px-2 py-1">
      <input
        // Focused on appearance: the field exists only because the writer just
        // clicked the control that creates it, so the caret belongs here.
        autoFocus
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-label={label}
        className="selectable w-full rounded-md bg-ink-850 px-2 py-1 text-[12px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-muted"
      />
    </form>
  );
}

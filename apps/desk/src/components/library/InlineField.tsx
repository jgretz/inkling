import {useCallback, useState} from 'react';
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
 */
export function InlineField({
  label,
  placeholder,
  initial = '',
  onSubmit,
  onCancel,
}: InlineFieldProps) {
  const [value, setValue] = useState(initial);

  const handleChange = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0) onCancel();
      else onSubmit(trimmed);
    },
    [value, onSubmit, onCancel],
  );

  const handleKeyDown = useCallback(
    function (event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Escape') onCancel();
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
        placeholder={placeholder}
        aria-label={label}
        className="selectable w-full rounded-md bg-ink-850 px-2 py-1 text-[12px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-muted"
      />
    </form>
  );
}

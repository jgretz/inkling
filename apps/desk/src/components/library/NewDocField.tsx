import {useCallback, useState} from 'react';
import type {ChangeEvent, FormEvent, KeyboardEvent} from 'react';
import {DOC_KINDS, type DocKind} from '@inkling/vault';

type NewDocFieldProps = {
  /** Names the title input for a screen reader, and says where it will land. */
  label: string;
  /** Names the kind select for a screen reader, and says where it will land. */
  kindLabel: string;
  placeholder: string;
  onSubmit: (value: string, kind: DocKind) => void;
  onCancel: () => void;
};

/** What a document is unless the writer says otherwise. */
const DEFAULT_KIND: DocKind = 'article';

/**
 * The field the library titles a new document with: a title, and what kind of
 * writing it is.
 *
 * Its own component rather than a flag on [`InlineField`], which names groups
 * and renames them and has no business carrying a kind. Everything else about
 * the two matches on purpose: submitting empty cancels, Escape cancels, the
 * caret starts in the title.
 *
 * The kind is picked here, at the only moment it is cheap to choose, because it
 * decides the template the document is made from. Changing it afterwards is
 * editing the frontmatter, which is a thing the writer can already do.
 */
export function NewDocField({label, kindLabel, placeholder, onSubmit, onCancel}: NewDocFieldProps) {
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<DocKind>(DEFAULT_KIND);

  const handleChange = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }, []);

  const handleKindChange = useCallback(function (event: ChangeEvent<HTMLSelectElement>) {
    setKind(event.target.value as DocKind);
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0) onCancel();
      else onSubmit(trimmed, kind);
    },
    [value, kind, onSubmit, onCancel],
  );

  const handleKeyDown = useCallback(
    function (event: KeyboardEvent<HTMLElement>) {
      if (event.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1 px-2 py-1">
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
        className="selectable min-w-0 flex-1 rounded-md bg-ink-850 px-2 py-1 text-[12px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-muted"
      />
      <select
        value={kind}
        onChange={handleKindChange}
        onKeyDown={handleKeyDown}
        aria-label={kindLabel}
        className="shrink-0 rounded-md bg-ink-850 px-1 py-1 text-[11px] capitalize text-ink-300 focus:outline-none focus:ring-1 focus:ring-accent-muted"
      >
        {DOC_KINDS.map(function (option) {
          return (
            <option key={option} value={option}>
              {option}
            </option>
          );
        })}
      </select>
    </form>
  );
}

import {useCallback, useState} from 'react';
import type {ChangeEvent, FocusEvent, FormEvent} from 'react';
import {Dialog} from '../shell/Dialog.tsx';
import {ACTIONS, DIALOG_BOX, DIALOG_TITLE, FIELD, FIELD_LABEL, PRIMARY, SECONDARY} from './form.ts';

type NameDialogProps = {
  title: string;
  fieldLabel: string;
  initial: string;
  placeholder?: string;
  submitLabel: string;
  /** Called with the trimmed value, only when it is not empty and not `initial`. */
  onSubmit: (value: string) => void;
  onClose: () => void;
  returnFocus: HTMLElement;
};

/**
 * A modal asking for one name: a document's new title, a group's new name, or
 * the name of a group to make.
 *
 * Submitting nothing, or what was already there, closes it and does nothing
 * else, which is what a writer who changed their mind expects from Enter.
 */
export function NameDialog({
  title,
  fieldLabel,
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
  returnFocus,
}: NameDialogProps) {
  const [value, setValue] = useState(initial);

  const handleChange = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }, []);

  // Selected, so typing replaces a name rather than appending to it.
  const handleFocus = useCallback(function (event: FocusEvent<HTMLInputElement>) {
    event.target.select();
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed === initial.trim()) onClose();
      else onSubmit(trimmed);
    },
    [value, initial, onSubmit, onClose],
  );

  return (
    <Dialog label={title} onClose={onClose} returnFocus={returnFocus} className={DIALOG_BOX}>
      <form onSubmit={handleSubmit}>
        <h2 className={DIALOG_TITLE}>{title}</h2>
        <label className={FIELD_LABEL}>
          {fieldLabel}
          <input
            data-autofocus
            type="text"
            value={value}
            onChange={handleChange}
            onFocus={handleFocus}
            placeholder={placeholder}
            className={FIELD}
          />
        </label>
        <div className={ACTIONS}>
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="submit" className={PRIMARY}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

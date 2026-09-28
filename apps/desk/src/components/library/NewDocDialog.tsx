import {useCallback, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {DOC_KINDS, type DocKind, type GroupPath} from '@inkling/vault';
import {Dialog} from '../shell/Dialog.tsx';
import {ACTIONS, DIALOG_BOX, DIALOG_TITLE, FIELD, FIELD_LABEL, PRIMARY, SECONDARY} from './form.ts';

type NewDocDialogProps = {
  /** Where it lands unless the writer picks elsewhere. `undefined` is the vault root. */
  group: GroupPath | undefined;
  /** Every group in the vault, which is where else it may land. */
  groups: readonly GroupPath[];
  onSubmit: (title: string, kind: DocKind, group: GroupPath | undefined) => void;
  onClose: () => void;
  returnFocus: HTMLElement;
};

/** What a document is unless the writer says otherwise. */
const DEFAULT_KIND: DocKind = 'article';

/**
 * A modal for a new document: its title, its kind and its group.
 *
 * The kind is picked here, at the only moment it is cheap to choose, because it
 * decides the template the document is made from. Changing it afterwards is
 * editing the frontmatter, which is a thing the writer can already do.
 */
export function NewDocDialog({group, groups, onSubmit, onClose, returnFocus}: NewDocDialogProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DocKind>(DEFAULT_KIND);
  // The empty string stands for the vault root, which no group path can be.
  const [where, setWhere] = useState<string>(group ?? '');

  const handleTitle = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
  }, []);

  const handleKind = useCallback(function (event: ChangeEvent<HTMLSelectElement>) {
    setKind(event.target.value as DocKind);
  }, []);

  const handleWhere = useCallback(function (event: ChangeEvent<HTMLSelectElement>) {
    setWhere(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const trimmed = title.trim();
      if (trimmed.length === 0) onClose();
      else onSubmit(trimmed, kind, where === '' ? undefined : (where as GroupPath));
    },
    [title, kind, where, onSubmit, onClose],
  );

  return (
    <Dialog label="New document" onClose={onClose} returnFocus={returnFocus} className={DIALOG_BOX}>
      <form onSubmit={handleSubmit}>
        <h2 className={DIALOG_TITLE}>New document</h2>
        <label className={FIELD_LABEL}>
          Title
          <input
            data-autofocus
            type="text"
            value={title}
            onChange={handleTitle}
            placeholder="Document title"
            className={FIELD}
          />
        </label>
        <label className={FIELD_LABEL}>
          Kind
          <select value={kind} onChange={handleKind} className={`${FIELD} capitalize`}>
            {DOC_KINDS.map(function (option) {
              return (
                <option key={option} value={option}>
                  {option}
                </option>
              );
            })}
          </select>
        </label>
        <label className={FIELD_LABEL}>
          Group
          <select value={where} onChange={handleWhere} className={FIELD}>
            <option value="">No group</option>
            {groups.map(function (option) {
              return (
                <option key={option} value={option}>
                  {option}
                </option>
              );
            })}
          </select>
        </label>
        <div className={ACTIONS}>
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="submit" className={PRIMARY}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

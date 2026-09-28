import {useCallback, useId, useMemo, useState} from 'react';
import type {ChangeEvent, FormEvent, KeyboardEvent} from 'react';
import {groupOf, type DocSummary, type GroupPath} from '@inkling/vault';
import {Dialog} from '../shell/Dialog.tsx';
import {ACTIONS, DIALOG_BOX, DIALOG_TITLE, FIELD, FIELD_LABEL, PRIMARY, SECONDARY} from './form.ts';

type MoveDialogProps = {
  doc: DocSummary;
  /** Every group in the vault, which is where the document may move to. */
  groups: readonly GroupPath[];
  /** Called with the group picked, or `undefined` for the vault root. */
  onSubmit: (group: GroupPath | undefined) => void;
  onClose: () => void;
  returnFocus: HTMLElement;
};

/** A destination. The empty key is the vault root, which no group path can be. */
type Destination = {key: string; label: string; current: boolean};

const ROOT = '';

/**
 * A modal for moving a document to another group, picked from a list the
 * writer can narrow by typing.
 *
 * The caret stays in the filter the whole time and the arrow keys move the
 * pick, so a writer with a hundred groups types three letters and presses
 * Enter. The group the document is already in is listed, so the list reads as
 * the whole vault, but it cannot be picked: moving a document to where it is
 * would be a write that changes nothing.
 */
export function MoveDialog({doc, groups, onSubmit, onClose, returnFocus}: MoveDialogProps) {
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const listId = useId();

  const shown = useMemo(
    function (): Destination[] {
      const here = groupOf(doc.path) ?? ROOT;
      const all = [
        {key: ROOT, label: 'No group'},
        ...groups.map(function (group) {
          return {key: group as string, label: group as string};
        }),
      ];
      const needle = filter.trim().toLowerCase();
      return all
        .filter(function (entry) {
          return entry.label.toLowerCase().includes(needle);
        })
        .map(function (entry) {
          return {...entry, current: entry.key === here};
        });
    },
    [doc.path, groups, filter],
  );

  const choices = useMemo(
    function () {
      return shown
        .filter(function (entry) {
          return !entry.current;
        })
        .map(function (entry) {
          return entry.key;
        });
    },
    [shown],
  );

  // A pick the filter has since hidden falls back to the first thing still
  // shown, so Enter always moves the document somewhere the writer can see.
  const selected = picked !== undefined && choices.includes(picked) ? picked : choices[0];

  const handleFilter = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setFilter(event.target.value);
  }, []);

  const handleKeyDown = useCallback(
    function (event: KeyboardEvent<HTMLInputElement>) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (choices.length === 0) return;
      const at = selected === undefined ? -1 : choices.indexOf(selected);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setPicked(choices[(at + step + choices.length) % choices.length]);
    },
    [choices, selected],
  );

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (selected === undefined) return;
      onSubmit(selected === ROOT ? undefined : (selected as GroupPath));
    },
    [selected, onSubmit],
  );

  const optionId = useCallback(
    function (key: string) {
      return `${listId}-${key === ROOT ? 'root' : key}`;
    },
    [listId],
  );

  return (
    <Dialog
      label={`Move ${doc.title}`}
      onClose={onClose}
      returnFocus={returnFocus}
      className={DIALOG_BOX}
    >
      <form onSubmit={handleSubmit}>
        <h2 className={DIALOG_TITLE}>Move {doc.title}</h2>
        <label className={FIELD_LABEL}>
          Filter groups
          <input
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={selected === undefined ? undefined : optionId(selected)}
            value={filter}
            onChange={handleFilter}
            onKeyDown={handleKeyDown}
            placeholder="Group name"
            className={FIELD}
          />
        </label>
        <ul
          id={listId}
          role="listbox"
          aria-label="Groups"
          className="max-h-60 overflow-y-auto rounded-md border border-ink-800 p-1"
        >
          {shown.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-ink-600">No groups match</li>
          )}
          {shown.map(function (entry) {
            const isSelected = entry.key === selected;
            return (
              <li
                key={entry.key}
                id={optionId(entry.key)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={entry.current ? 'true' : undefined}
                onMouseDown={function (event) {
                  // Keeps the caret in the filter, where the arrow keys work.
                  event.preventDefault();
                }}
                onClick={function () {
                  if (!entry.current) setPicked(entry.key);
                }}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-[12px] ${
                  entry.current
                    ? 'text-ink-600'
                    : isSelected
                      ? 'bg-ink-700 text-ink-100'
                      : 'text-ink-200 hover:bg-ink-800'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.current && <span className="shrink-0 text-[11px]">current</span>}
              </li>
            );
          })}
        </ul>
        <div className={ACTIONS}>
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={selected === undefined} className={PRIMARY}>
            Move
          </button>
        </div>
      </form>
    </Dialog>
  );
}

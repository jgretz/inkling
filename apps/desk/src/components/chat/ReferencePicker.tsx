import {useCallback, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {groupName, type DocPath, type DocSummary, type GroupPath} from '@inkling/vault';
import type {AttachRequest} from '../../lib/use-references.ts';
import type {ReferenceKind} from '../../lib/references.ts';

type ReferencePickerProps = {
  /** Every document in the vault, which is what a `doc` reference may name. */
  docs: readonly DocSummary[];
  /** The open document's nearest group, when it is in one. */
  group: GroupPath | undefined;
  onSubmit: (request: AttachRequest) => void;
  onCancel: () => void;
};

/** Everything the form holds, in one state: the fields decide each other. */
type Draft = {
  kind: ReferenceKind;
  /** The chosen vault document, for a `doc` reference. */
  target: string;
  /** The address, for a `link`. */
  url: string;
  title: string;
  level: 'document' | 'group';
};

const EMPTY: Draft = {kind: 'doc', target: '', url: '', title: '', level: 'document'};

const KIND_LABELS: Record<ReferenceKind, string> = {
  doc: 'Vault document',
  link: 'Web link',
  note: 'New note',
};

const FIELD =
  'w-full rounded bg-ink-850 px-1.5 py-1 text-[11px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-muted';

const BUTTON = 'rounded px-2 py-1 text-[11px] transition-colors duration-100 disabled:opacity-30';

/**
 * What a reference needs before it can be attached.
 *
 * A `doc` needs the document it names, a `link` needs an address, and a note
 * needs a title, because the title is what its markdown file is named after.
 */
function ready(draft: Draft): boolean {
  if (draft.kind === 'doc') return draft.target.length > 0;
  if (draft.kind === 'link') return draft.url.trim().length > 0;
  return draft.title.trim().length > 0;
}

/**
 * The title a chip will carry, falling back to something the writer recognises
 * rather than making them type a name for a document that already has one.
 */
function titleOf(draft: Draft, docs: readonly DocSummary[]): string {
  const typed = draft.title.trim();
  if (typed.length > 0) return typed;
  if (draft.kind === 'link') return draft.url.trim();
  const named = docs.find(function (doc) {
    return doc.path === draft.target;
  });
  return named?.title ?? draft.target;
}

/**
 * Attaching one reference: its kind, what it points at, and which level owns it.
 *
 * The level matters more than it looks: attaching to the group puts the
 * reference into every document inside it, which is why it is a deliberate
 * choice on the form rather than a default the writer discovers afterwards.
 */
export function ReferencePicker({docs, group, onSubmit, onCancel}: ReferencePickerProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const edit = useCallback(function (patch: Partial<Draft>) {
    setDraft(function (current) {
      return {...current, ...patch};
    });
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!ready(draft)) return;
      onSubmit({
        level: draft.level,
        kind: draft.kind,
        title: titleOf(draft, docs),
        targetPath: draft.kind === 'doc' ? (draft.target as DocPath) : undefined,
        url: draft.kind === 'link' ? draft.url.trim() : undefined,
      });
      setDraft(EMPTY);
    },
    [docs, draft, onSubmit],
  );

  const handleKind = useCallback(
    function (event: ChangeEvent<HTMLSelectElement>) {
      edit({kind: event.target.value as ReferenceKind});
    },
    [edit],
  );

  const handleTarget = useCallback(
    function (event: ChangeEvent<HTMLSelectElement>) {
      edit({target: event.target.value});
    },
    [edit],
  );

  const handleUrl = useCallback(
    function (event: ChangeEvent<HTMLInputElement>) {
      edit({url: event.target.value});
    },
    [edit],
  );

  const handleTitle = useCallback(
    function (event: ChangeEvent<HTMLInputElement>) {
      edit({title: event.target.value});
    },
    [edit],
  );

  const handleLevel = useCallback(
    function (event: ChangeEvent<HTMLSelectElement>) {
      edit({level: event.target.value as Draft['level']});
    },
    [edit],
  );

  return (
    <form onSubmit={handleSubmit} className="mb-1.5 space-y-1 rounded bg-ink-900 p-1.5">
      <select
        aria-label="Kind of reference"
        value={draft.kind}
        onChange={handleKind}
        className={FIELD}
      >
        {(Object.keys(KIND_LABELS) as ReferenceKind[]).map(function (kind) {
          return (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          );
        })}
      </select>

      {draft.kind === 'doc' && (
        <select
          aria-label="Document to attach"
          value={draft.target}
          onChange={handleTarget}
          className={FIELD}
        >
          <option value="">Choose a document</option>
          {docs.map(function (doc) {
            return (
              <option key={doc.path} value={doc.path}>
                {doc.title}
              </option>
            );
          })}
        </select>
      )}

      {draft.kind === 'link' && (
        <input
          aria-label="Address"
          value={draft.url}
          onChange={handleUrl}
          placeholder="https://"
          className={FIELD}
        />
      )}

      <input
        aria-label={draft.kind === 'note' ? 'Note title' : 'Title'}
        value={draft.title}
        onChange={handleTitle}
        placeholder={draft.kind === 'note' ? 'What the note is about' : 'Title (optional)'}
        className={FIELD}
      />

      <select
        aria-label="Attach to"
        value={draft.level}
        onChange={handleLevel}
        className={FIELD}
        disabled={group === undefined}
      >
        <option value="document">This document</option>
        {group !== undefined && <option value="group">Everything in {groupName(group)}</option>}
      </select>

      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className={`${BUTTON} text-ink-400 hover:bg-ink-800`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!ready(draft)}
          className={`${BUTTON} bg-accent text-ink-950 hover:opacity-90`}
        >
          Attach
        </button>
      </div>
    </form>
  );
}

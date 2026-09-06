import {memo} from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type {DocKind, DocPath, DocSummary, GroupPath} from '@inkling/vault';
import {DocRow} from './DocRow.tsx';
import {NewDocField} from './NewDocField.tsx';

type RootSectionProps = {
  docs: readonly DocSummary[];
  openPath: DocPath | undefined;
  /** Every group in the vault, for the move control on each document. */
  groups: readonly GroupPath[];
  open: boolean;
  /** True while the writer is titling a new document destined for the root. */
  naming: boolean;
  onToggle: () => void;
  onOpen: (path: DocPath) => void;
  onMove: (from: DocPath, to: DocPath) => void;
  /** Raises a document's delete. The confirmation is put in `App.tsx`. */
  onDeleteDoc: (path: DocPath) => void;
  onSubmit: (value: string, kind: DocKind) => void;
  onCancel: () => void;
};

/**
 * The documents at the vault root, in a section with no name.
 *
 * It looks like a group and is not one. The root is where a rule set governs
 * every document rather than one folder's worth, which is why `docs/model.md`
 * keeps Root and Group as separate rows, and why this collapses on its own flag
 * rather than on a sentinel wedged into the list of collapsed group paths.
 */
export const RootSection = memo(function RootSection({
  docs,
  openPath,
  groups,
  open,
  naming,
  onToggle,
  onOpen,
  onMove,
  onDeleteDoc,
  onSubmit,
  onCancel,
}: RootSectionProps) {
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] uppercase tracking-wider text-ink-400 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
      >
        <Chevron size={12} className="shrink-0 text-ink-600" aria-hidden />
        <span className="truncate">No group</span>
      </button>

      {naming && (
        <NewDocField
          label="Title of the new document"
          kindLabel="Kind of the new document"
          placeholder="Document title"
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}

      {open && (
        <ul className="space-y-0.5">
          {docs.map(function (doc) {
            return (
              <li key={doc.path}>
                <DocRow
                  doc={doc}
                  active={doc.path === openPath}
                  groups={groups}
                  onOpen={onOpen}
                  onMove={onMove}
                  onDelete={onDeleteDoc}
                />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
});

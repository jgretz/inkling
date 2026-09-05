import {memo, useCallback} from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import FilePlus from 'lucide-react/dist/esm/icons/file-plus';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import type {DocPath, GroupNode, GroupPath} from '@inkling/vault';
import {DocRow} from './DocRow.tsx';
import {InlineField} from './InlineField.tsx';

/**
 * Which inline field is open, and what it will name when it is submitted.
 *
 * One value rather than a flag per affordance: at most one field is ever open,
 * and three booleans would let two of them be true.
 */
export type Editing =
  | {kind: 'newGroup'; parent: GroupPath | undefined}
  | {kind: 'renameGroup'; group: GroupPath}
  | {kind: 'newDoc'; group: GroupPath | undefined};

/**
 * How deep the tree indents before it stops.
 *
 * Groups nest arbitrarily, but a 200-pixel panel runs out of room long before
 * a writer runs out of folders. Past this depth every group renders at the same
 * indent and carries the rest of its path in its label, so a deeply buried
 * group is cramped rather than unreachable.
 */
export const MAX_DEPTH = 2;

const INDENT_PX = 10;

/**
 * How far a group steps in **from the group above it**, in pixels.
 *
 * Relative rather than absolute, because a group is rendered inside its
 * parent's list and the two paddings add up. Past [`MAX_DEPTH`] the step is
 * zero, so everything deeper shares the third indent.
 */
export function indentOf(group: string): number {
  const depth = group.split('/').length - 1;
  return depth >= 1 && depth <= MAX_DEPTH ? INDENT_PX : 0;
}

/**
 * What a group row is labelled with: its own name, or, once the indent has run
 * out, enough of its path to tell it from its cousins.
 */
export function labelOf(group: string): string {
  const segments = group.split('/');
  if (segments.length - 1 <= MAX_DEPTH) return segments[segments.length - 1] ?? group;
  return segments.slice(MAX_DEPTH).join('/');
}

const ACTION =
  'shrink-0 rounded p-1 text-ink-600 opacity-0 transition-opacity duration-100 hover:text-ink-200 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-accent-muted group-hover/group:opacity-100';

type GroupRowProps = {
  node: GroupNode;
  openPath: DocPath | undefined;
  /** Every group in the vault, for the move control on each document. */
  groups: readonly GroupPath[];
  /** Group paths the writer has folded shut. Everything else is open. */
  collapsed: readonly string[];
  editing: Editing | undefined;
  onToggle: (group: GroupPath) => void;
  onOpen: (path: DocPath) => void;
  onMove: (from: DocPath, to: DocPath) => void;
  onEdit: (editing: Editing | undefined) => void;
  /** Applies whatever `editing` names to the value the writer typed. */
  onSubmit: (value: string) => void;
};

/** One group, its documents, and every group below it. */
export const GroupRow = memo(function GroupRow({
  node,
  openPath,
  groups,
  collapsed,
  editing,
  onToggle,
  onOpen,
  onMove,
  onEdit,
  onSubmit,
}: GroupRowProps) {
  const open = !collapsed.includes(node.path);
  const Chevron = open ? ChevronDown : ChevronRight;
  const renaming = editing?.kind === 'renameGroup' && editing.group === node.path;
  const naming = editing?.kind === 'newDoc' && editing.group === node.path;

  const handleToggle = useCallback(
    function () {
      onToggle(node.path);
    },
    [node.path, onToggle],
  );

  const handleRename = useCallback(
    function () {
      onEdit({kind: 'renameGroup', group: node.path});
    },
    [node.path, onEdit],
  );

  const handleNewDoc = useCallback(
    function () {
      onEdit({kind: 'newDoc', group: node.path});
    },
    [node.path, onEdit],
  );

  const handleCancel = useCallback(
    function () {
      onEdit(undefined);
    },
    [onEdit],
  );

  const label = labelOf(node.path);

  return (
    <li style={{paddingLeft: indentOf(node.path)}}>
      {renaming ? (
        <InlineField
          label={`Rename the group ${label}`}
          placeholder="Group name"
          initial={label}
          onSubmit={onSubmit}
          onCancel={handleCancel}
        />
      ) : (
        <div className="group/group flex items-center">
          <button
            type="button"
            aria-expanded={open}
            onClick={handleToggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] uppercase tracking-wider text-ink-400 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
          >
            <Chevron size={12} className="shrink-0 text-ink-600" aria-hidden />
            <span className="truncate">{label}</span>
          </button>

          <button
            type="button"
            aria-label={`Rename the group ${label}`}
            onClick={handleRename}
            className={ACTION}
          >
            <Pencil size={12} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`New document in ${label}`}
            onClick={handleNewDoc}
            className={ACTION}
          >
            <FilePlus size={12} aria-hidden />
          </button>
        </div>
      )}

      {naming && (
        <InlineField
          label={`Title of the new document in ${label}`}
          placeholder="Document title"
          onSubmit={onSubmit}
          onCancel={handleCancel}
        />
      )}

      {open && (
        <ul className="space-y-0.5">
          {node.docs.map(function (doc) {
            return (
              <li key={doc.path}>
                <DocRow
                  doc={doc}
                  active={doc.path === openPath}
                  groups={groups}
                  onOpen={onOpen}
                  onMove={onMove}
                />
              </li>
            );
          })}
          {node.children.map(function (child) {
            return (
              <GroupRow
                key={child.path}
                node={child}
                openPath={openPath}
                groups={groups}
                collapsed={collapsed}
                editing={editing}
                onToggle={onToggle}
                onOpen={onOpen}
                onMove={onMove}
                onEdit={onEdit}
                onSubmit={onSubmit}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
});

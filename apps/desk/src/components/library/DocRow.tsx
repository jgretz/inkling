import {memo, useCallback} from 'react';
import type {ChangeEvent} from 'react';
import {groupOf, movedTo, type DocPath, type DocSummary, type GroupPath} from '@inkling/vault';

type DocRowProps = {
  doc: DocSummary;
  active: boolean;
  /** Every group in the vault, which is where this document may move to. */
  groups: readonly GroupPath[];
  onOpen: (path: DocPath) => void;
  onMove: (from: DocPath, to: DocPath) => void;
};

/** Short relative time. Anything past a week reads better as a date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/**
 * One document, as a button that opens it plus a control that moves it.
 *
 * The move is a `select` rather than a drag: a writer moving a piece between
 * groups is picking a destination by name, the whole list of destinations is
 * already known, and a native select is reachable by keyboard and testable
 * without a pointer.
 */
export const DocRow = memo(function DocRow({doc, active, groups, onOpen, onMove}: DocRowProps) {
  const handleClick = useCallback(
    function () {
      onOpen(doc.path);
    },
    [doc.path, onOpen],
  );

  const handleMove = useCallback(
    function (event: ChangeEvent<HTMLSelectElement>) {
      const group = event.target.value;
      onMove(doc.path, movedTo(doc.path, group === '' ? undefined : (group as GroupPath)));
    },
    [doc.path, onMove],
  );

  return (
    <div className="group/row flex items-center">
      <button
        type="button"
        onClick={handleClick}
        aria-current={active ? 'true' : undefined}
        className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors duration-100 ${
          active ? 'bg-ink-700' : 'hover:bg-ink-800'
        }`}
      >
        <div className="truncate text-[13px] text-ink-100">{doc.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
          <span className="tabular-nums">{relativeTime(doc.updatedAt)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{doc.words.toLocaleString()}w</span>
          {doc.kind !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span>{doc.kind}</span>
            </>
          )}
        </div>
      </button>

      <select
        value={groupOf(doc.path) ?? ''}
        onChange={handleMove}
        aria-label={`Move ${doc.title} to a group`}
        className="selectable ml-1 shrink-0 rounded-md bg-transparent px-1 py-1 text-[11px] text-ink-600 opacity-0 transition-opacity duration-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-accent-muted group-hover/row:opacity-100"
      >
        <option value="">No group</option>
        {groups.map(function (group) {
          return (
            <option key={group} value={group}>
              {group}
            </option>
          );
        })}
      </select>
    </div>
  );
});

import {memo, useCallback, useDeferredValue, useMemo, useState} from 'react';
import type {ChangeEvent} from 'react';
import Search from 'lucide-react/dist/esm/icons/search';
import type {DocPath, DocSummary} from '@inkling/vault';

type LibraryPanelProps = {
  docs: DocSummary[];
  openPath: DocPath | undefined;
  vaultName: string;
  onOpen: (path: DocPath) => void;
  onChooseVault: () => void;
};

type RowProps = {
  doc: DocSummary;
  active: boolean;
  onOpen: (path: DocPath) => void;
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

/** Case-insensitive match across the fields a writer would search by. */
export function matchesQuery(doc: DocSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [doc.title, doc.path, ...doc.tags].join(' ').toLowerCase();
  return haystack.includes(needle);
}

const Row = memo(function Row({doc, active, onOpen}: RowProps) {
  const handleClick = useCallback(
    function () {
      onOpen(doc.path);
    },
    [doc.path, onOpen],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={active ? 'true' : undefined}
      className={`w-full rounded-md px-2 py-1.5 text-left transition-colors duration-100 ${
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
  );
});

/** The document list: search, then everything in the vault, newest first. */
export function LibraryPanel({
  docs,
  openPath,
  vaultName,
  onOpen,
  onChooseVault,
}: LibraryPanelProps) {
  const [query, setQuery] = useState('');
  // The list re-filters on a background render so typing never stutters.
  const deferred = useDeferredValue(query);

  const visible = useMemo(
    function () {
      return docs.filter(function (doc) {
        return matchesQuery(doc, deferred);
      });
    },
    [docs, deferred],
  );

  const handleQuery = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }, []);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-ink-950">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <button
          type="button"
          onClick={onChooseVault}
          className="truncate text-[11px] font-medium uppercase tracking-wider text-ink-400 transition-colors duration-100 hover:text-ink-200"
          title="Choose a different vault"
        >
          {vaultName}
        </button>
        <span className="text-[11px] tabular-nums text-ink-600">{visible.length}</span>
      </div>

      <div className="relative px-3 py-2">
        <Search
          size={13}
          aria-hidden
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-600"
        />
        <input
          type="search"
          value={query}
          onChange={handleQuery}
          placeholder="Search"
          aria-label="Search documents"
          className="selectable w-full rounded-md bg-ink-850 py-1.5 pl-6 pr-2 text-[12px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-muted"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-600">
            {docs.length === 0 ? 'No documents yet' : 'Nothing matches'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map(function (doc) {
              return (
                <li key={doc.path}>
                  <Row doc={doc} active={doc.path === openPath} onOpen={onOpen} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

import {useCallback, useDeferredValue, useMemo, useState} from 'react';
import type {ChangeEvent} from 'react';
import {match} from 'ts-pattern';
import FilePlus from 'lucide-react/dist/esm/icons/file-plus';
import FolderPlus from 'lucide-react/dist/esm/icons/folder-plus';
import Search from 'lucide-react/dist/esm/icons/search';
import {
  filterTree,
  groupTree,
  movedTo,
  type DocPath,
  type DocSummary,
  type GroupNode,
  type GroupPath,
} from '@inkling/vault';
import {GroupRow, type Editing} from './GroupRow.tsx';
import {InlineField} from './InlineField.tsx';
import {RootSection} from './RootSection.tsx';

type LibraryPanelProps = {
  docs: DocSummary[];
  /** Every directory in the vault, so a group with nothing in it still shows. */
  groups: readonly GroupPath[];
  openPath: DocPath | undefined;
  vaultName: string;
  onOpen: (path: DocPath) => void;
  onChooseVault: () => void;
  onCreateGroup: (path: GroupPath) => void;
  onRenameGroup: (from: GroupPath, to: GroupPath) => void;
  onMoveDoc: (from: DocPath, to: DocPath) => void;
  onCreateDoc: (path: DocPath, title: string) => void;
};

/** A stable empty list, so a filtered render does not break `GroupRow`'s memo. */
const NOTHING_COLLAPSED: readonly string[] = [];

const HEADER_ACTION =
  'rounded p-1 text-ink-600 transition-colors duration-100 hover:text-ink-200 focus:outline-none focus:ring-1 focus:ring-accent-muted';

/**
 * The filename a title becomes: lowercase, words joined by hyphens, `.md`.
 *
 * Anything that is not a letter, a digit or a hyphen goes, because the writer's
 * title is prose and this is a path. A title that survives none of that falls
 * back to `untitled`, which is a file they can rename rather than an error they
 * have to read.
 */
export function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug.length === 0 ? 'untitled' : slug}.md`;
}

/**
 * The library: search, then the vault as the writer's own folders arrange it.
 *
 * Documents at the vault root come first, in a section with no name, because
 * the root is not a group. `docs/model.md` keeps Root and Group as separate
 * rows for the same reason: a group is where a voice rule set lives, and the
 * root's rule set governs everything rather than one folder's worth.
 *
 * Groups start open. The flat list this replaced showed every document at once,
 * and a library that hides most of itself on first sight is a worse answer to
 * "what am I working on" than a long list.
 */
export function LibraryPanel({
  docs,
  groups,
  openPath,
  vaultName,
  onOpen,
  onChooseVault,
  onCreateGroup,
  onRenameGroup,
  onMoveDoc,
  onCreateDoc,
}: LibraryPanelProps) {
  const [query, setQuery] = useState('');
  // The list re-filters on a background render so typing never stutters.
  const deferred = useDeferredValue(query);
  // Groups the writer folded shut, keyed by path. The ungrouped section gets
  // its own flag rather than a sentinel in here, which holds group paths and
  // would collide with a group named after the sentinel.
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [rootOpen, setRootOpen] = useState(true);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);

  const tree = useMemo(
    function () {
      return filterTree(groupTree(docs, groups), deferred);
    },
    [docs, groups, deferred],
  );

  const visible = useMemo(
    function () {
      return tree.root.length + countDocs(tree.groups);
    },
    [tree],
  );

  const handleQuery = useCallback(function (event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }, []);

  const toggleGroup = useCallback(function (group: GroupPath) {
    setCollapsed(function (current) {
      return current.includes(group)
        ? current.filter(function (entry) {
            return entry !== group;
          })
        : [...current, group];
    });
  }, []);

  const toggleRoot = useCallback(function () {
    setRootOpen(function (open) {
      return !open;
    });
  }, []);

  const startNewGroup = useCallback(function () {
    setEditing({kind: 'newGroup'});
  }, []);

  const startNewDoc = useCallback(function () {
    setEditing({kind: 'newDoc', group: undefined});
  }, []);

  const cancelEditing = useCallback(function () {
    setEditing(undefined);
  }, []);

  const submitEditing = useCallback(
    function (value: string) {
      if (editing === undefined) return;
      setEditing(undefined);
      // Exhaustive rather than an if-chain ending in a fallthrough: a fourth
      // kind of field added later must not quietly write a document.
      match(editing)
        .with({kind: 'newGroup'}, function () {
          // A path rather than a name, if that is what the writer typed: the
          // Rust side makes every group above it that does not exist yet.
          onCreateGroup(value as GroupPath);
        })
        .with({kind: 'renameGroup'}, function ({group}) {
          // Only the last segment is editable, so a rename stays a rename:
          // moving a group somewhere else is a different gesture the panel does
          // not offer yet.
          const parent = group.split('/').slice(0, -1).join('/');
          onRenameGroup(group, (parent === '' ? value : `${parent}/${value}`) as GroupPath);
        })
        .with({kind: 'newDoc'}, function ({group}) {
          onCreateDoc(movedTo(fileNameFor(value), group), value);
        })
        .exhaustive();
    },
    [editing, onCreateGroup, onRenameGroup, onCreateDoc],
  );

  const naming = editing?.kind === 'newDoc' && editing.group === undefined;
  // While a query is running, every section is open. A filter that leaves its
  // own matches folded out of sight has not answered the question, and the
  // writer's own collapse state is still there when they clear the box.
  const filtering = deferred.trim().length > 0;
  const foldedShut = filtering ? NOTHING_COLLAPSED : collapsed;
  const rootShown = rootOpen || filtering;

  return (
    <aside className="flex h-full min-w-0 flex-col bg-ink-950">
      <div className="flex items-center gap-1 px-3 pb-1 pt-3">
        <button
          type="button"
          onClick={onChooseVault}
          className="min-w-0 flex-1 truncate text-left text-[11px] font-medium uppercase tracking-wider text-ink-400 transition-colors duration-100 hover:text-ink-200"
          title="Choose a different vault"
        >
          {vaultName}
        </button>
        <button
          type="button"
          aria-label="New group"
          onClick={startNewGroup}
          className={HEADER_ACTION}
        >
          <FolderPlus size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="New document"
          onClick={startNewDoc}
          className={HEADER_ACTION}
        >
          <FilePlus size={13} aria-hidden />
        </button>
        <span className="text-[11px] tabular-nums text-ink-600">{visible}</span>
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

      {editing?.kind === 'newGroup' && (
        <InlineField
          label="Name of the new group"
          placeholder="Group name, or a path like essays/2026"
          onSubmit={submitEditing}
          onCancel={cancelEditing}
        />
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {/* A group with nothing in it is still something to show: the writer
            just made it, and an empty state over the top would look like the
            create had failed. */}
        {visible === 0 && tree.groups.length === 0 && !naming ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-600">
            {docs.length === 0 ? 'No documents yet' : 'Nothing matches'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {(tree.root.length > 0 || naming) && (
              <RootSection
                docs={tree.root}
                openPath={openPath}
                groups={groups}
                open={rootShown}
                naming={naming}
                onToggle={toggleRoot}
                onOpen={onOpen}
                onMove={onMoveDoc}
                onSubmit={submitEditing}
                onCancel={cancelEditing}
              />
            )}

            {tree.groups.map(function (node) {
              return (
                <GroupRow
                  key={node.path}
                  node={node}
                  openPath={openPath}
                  groups={groups}
                  collapsed={foldedShut}
                  editing={editing}
                  onToggle={toggleGroup}
                  onOpen={onOpen}
                  onMove={onMoveDoc}
                  onEdit={setEditing}
                  onSubmit={submitEditing}
                />
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Every document in the tree, however deep, for the count in the header. */
function countDocs(nodes: readonly GroupNode[]): number {
  return nodes.reduce(function (total, node) {
    return total + node.docs.length + countDocs(node.children);
  }, 0);
}

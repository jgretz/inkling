import {useCallback, useDeferredValue, useMemo, useState} from 'react';
import type {ChangeEvent, MouseEvent} from 'react';
import {match, P} from 'ts-pattern';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import {
  filterTree,
  groupName,
  groupTree,
  movedTo,
  type DocKind,
  type DocPath,
  type DocSummary,
  type GroupNode,
  type GroupPath,
} from '@inkling/vault';
import {ActionMenu} from './ActionMenu.tsx';
import {GroupRow} from './GroupRow.tsx';
import {
  fileNameFor,
  menuItemsFor,
  renamedDoc,
  renamedGroup,
  targetKey,
  type MenuItem,
  type Surface,
  type Target,
} from './library-actions.ts';
import {MoveDialog} from './MoveDialog.tsx';
import {NameDialog} from './NameDialog.tsx';
import {NewDocDialog} from './NewDocDialog.tsx';
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
  onCreateDoc: (path: DocPath, title: string, kind: DocKind) => void;
  /**
   * Raises a delete. The panel asks nothing: the confirmation is put in
   * `App.tsx`, where the two `confirm` call sites already live.
   */
  onDeleteDoc: (path: DocPath) => void;
  onDeleteGroup: (group: GroupPath) => void;
};

/** A stable empty list, so a filtered render does not break `GroupRow`'s memo. */
const NOTHING_COLLAPSED: readonly string[] = [];

const HEADER_TARGET: Target = {kind: 'header'};

/** Gap between a ⋯ and the menu hanging under it, in pixels. */
const MENU_GAP = 2;

/**
 * The library: search, then the vault as the writer's own folders arrange it.
 *
 * Documents at the vault root come first, in a section of their own, because
 * the root is not a group. `docs/model.md` keeps Root and Group as separate
 * rows for the same reason: a group is where a voice rule set lives, and the
 * root's rule set governs everything rather than one folder's worth.
 *
 * The tree is for getting around, so a row is a title and a click opens it.
 * Every edit is raised from a row's ⋯, a right-click or the header's `+`, and
 * finished in a modal when it needs anything typed or picked, so nothing opens
 * inside the tree and pushes the rows the writer is looking at out of place.
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
  onDeleteDoc,
  onDeleteGroup,
}: LibraryPanelProps) {
  const [query, setQuery] = useState('');
  // The list re-filters on a background render so typing never stutters.
  const deferred = useDeferredValue(query);
  // Groups the writer folded shut, keyed by path. The ungrouped section gets
  // its own flag rather than a sentinel in here, which holds group paths and
  // would collide with a group named after the sentinel.
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [rootOpen, setRootOpen] = useState(true);
  const [surface, setSurface] = useState<Surface | undefined>(undefined);

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

  const close = useCallback(function () {
    setSurface(undefined);
  }, []);

  const openMenu = useCallback(function (
    target: Target,
    at: {x: number; y: number} | undefined,
    trigger: HTMLElement,
  ) {
    const box = trigger.getBoundingClientRect();
    const anchor = at ?? {x: box.left, y: box.bottom + MENU_GAP};
    setSurface(function (current) {
      // A second click on the ⋯ whose menu is up closes it, as any menu
      // button does. A right-click always opens, at wherever it landed.
      if (at === undefined && current?.kind === 'menu' && current.trigger === trigger) {
        return undefined;
      }
      return {kind: 'menu', target, at: anchor, trigger};
    });
  }, []);

  const openHeaderMenu = useCallback(
    function (event: MouseEvent<HTMLButtonElement>) {
      openMenu(HEADER_TARGET, undefined, event.currentTarget);
    },
    [openMenu],
  );

  const handleSelect = useCallback(
    function (item: MenuItem) {
      if (surface?.kind !== 'menu') return;
      const {trigger} = surface;
      match(item.command)
        .with({kind: 'deleteDoc'}, function ({doc}) {
          setSurface(undefined);
          onDeleteDoc(doc.path);
        })
        .with({kind: 'deleteGroup'}, function ({group}) {
          setSurface(undefined);
          onDeleteGroup(group);
        })
        .with(
          {kind: P.union('renameDoc', 'renameGroup', 'moveDoc', 'newDoc', 'newGroup')},
          function (modal) {
            setSurface({...modal, trigger});
          },
        )
        .exhaustive();
    },
    [surface, onDeleteDoc, onDeleteGroup],
  );

  const submitRenameDoc = useCallback(
    function (title: string) {
      if (surface?.kind !== 'renameDoc') return;
      setSurface(undefined);
      const to = renamedDoc(surface.doc.path, title);
      if (to !== undefined) onMoveDoc(surface.doc.path, to);
    },
    [surface, onMoveDoc],
  );

  const submitRenameGroup = useCallback(
    function (name: string) {
      if (surface?.kind !== 'renameGroup') return;
      setSurface(undefined);
      const to = renamedGroup(surface.group, name);
      if (to !== undefined) onRenameGroup(surface.group, to);
    },
    [surface, onRenameGroup],
  );

  const submitNewGroup = useCallback(
    function (value: string) {
      setSurface(undefined);
      // A path rather than a name, if that is what the writer typed: the Rust
      // side makes every group above it that does not exist yet.
      onCreateGroup(value as GroupPath);
    },
    [onCreateGroup],
  );

  const submitMove = useCallback(
    function (group: GroupPath | undefined) {
      if (surface?.kind !== 'moveDoc') return;
      setSurface(undefined);
      onMoveDoc(surface.doc.path, movedTo(surface.doc.path, group));
    },
    [surface, onMoveDoc],
  );

  const submitNewDoc = useCallback(
    function (title: string, kind: DocKind, group: GroupPath | undefined) {
      setSurface(undefined);
      onCreateDoc(movedTo(fileNameFor(title), group), title, kind);
    },
    [onCreateDoc],
  );

  // While a query is running, every section is open. A filter that leaves its
  // own matches folded out of sight has not answered the question, and the
  // writer's own collapse state is still there when they clear the box.
  const filtering = deferred.trim().length > 0;
  const foldedShut = filtering ? NOTHING_COLLAPSED : collapsed;
  const rootShown = rootOpen || filtering;
  const menuKey = surface?.kind === 'menu' ? targetKey(surface.target) : undefined;

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
          aria-label="New"
          aria-haspopup="menu"
          aria-expanded={menuKey === targetKey(HEADER_TARGET)}
          onClick={openHeaderMenu}
          className="rounded p-1 text-ink-400 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-muted"
        >
          <Plus size={14} aria-hidden />
        </button>
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
        {/* A group with nothing in it is still something to show: the writer
            just made it, and an empty state over the top would look like the
            create had failed. */}
        {visible === 0 && tree.groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-600">
            {docs.length === 0 ? 'No documents yet' : 'Nothing matches'}
          </p>
        ) : (
          <ul className="space-y-px">
            {tree.root.length > 0 && (
              <RootSection
                docs={tree.root}
                openPath={openPath}
                open={rootShown}
                menuKey={menuKey}
                onToggle={toggleRoot}
                onOpen={onOpen}
                onMenu={openMenu}
              />
            )}

            {tree.groups.map(function (node) {
              return (
                <GroupRow
                  key={node.path}
                  node={node}
                  openPath={openPath}
                  collapsed={foldedShut}
                  menuKey={menuKey}
                  onToggle={toggleGroup}
                  onOpen={onOpen}
                  onMenu={openMenu}
                />
              );
            })}
          </ul>
        )}
      </div>

      {surface !== undefined &&
        match(surface)
          .with({kind: 'menu'}, function (menu) {
            return (
              // Keyed by row, so a right-click on another row while this one's
              // menu is up opens a fresh menu rather than carrying the old
              // one's caret position over to a different list.
              <ActionMenu
                key={targetKey(menu.target)}
                label={menuLabel(menu.target)}
                items={menuItemsFor(menu.target)}
                at={menu.at}
                trigger={menu.trigger}
                onSelect={handleSelect}
                onClose={close}
              />
            );
          })
          .with({kind: 'renameDoc'}, function ({doc, trigger}) {
            return (
              <NameDialog
                title={`Rename ${doc.title}`}
                fieldLabel="Title"
                initial={doc.title}
                submitLabel="Rename"
                onSubmit={submitRenameDoc}
                onClose={close}
                returnFocus={trigger}
              />
            );
          })
          .with({kind: 'renameGroup'}, function ({group, trigger}) {
            return (
              <NameDialog
                title={`Rename the group ${groupName(group)}`}
                fieldLabel="Name"
                initial={groupName(group)}
                submitLabel="Rename"
                onSubmit={submitRenameGroup}
                onClose={close}
                returnFocus={trigger}
              />
            );
          })
          .with({kind: 'newGroup'}, function ({trigger}) {
            return (
              <NameDialog
                title="New group"
                fieldLabel="Name"
                initial=""
                placeholder="Group name, or a path like essays/2026"
                submitLabel="Create"
                onSubmit={submitNewGroup}
                onClose={close}
                returnFocus={trigger}
              />
            );
          })
          .with({kind: 'moveDoc'}, function ({doc, trigger}) {
            return (
              <MoveDialog
                doc={doc}
                groups={groups}
                onSubmit={submitMove}
                onClose={close}
                returnFocus={trigger}
              />
            );
          })
          .with({kind: 'newDoc'}, function ({group, trigger}) {
            return (
              <NewDocDialog
                group={group}
                groups={groups}
                onSubmit={submitNewDoc}
                onClose={close}
                returnFocus={trigger}
              />
            );
          })
          .exhaustive()}
    </aside>
  );
}

/** Names a menu for a screen reader by the row it was raised on. */
function menuLabel(target: Target): string {
  return match(target)
    .with({kind: 'doc'}, function ({doc}) {
      return `Actions for ${doc.title}`;
    })
    .with({kind: 'group'}, function ({group}) {
      return `Actions for the group ${group}`;
    })
    .with({kind: 'header'}, function () {
      return 'New';
    })
    .exhaustive();
}

/** Every document in the tree, however deep, for the empty state. */
function countDocs(nodes: readonly GroupNode[]): number {
  return nodes.reduce(function (total, node) {
    return total + node.docs.length + countDocs(node.children);
  }, 0);
}

import {memo, useCallback, useMemo, useRef} from 'react';
import type {MouseEvent} from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type {DocPath, GroupNode, GroupPath} from '@inkling/vault';
import {DocRow} from './DocRow.tsx';
import {targetKey, type Target} from './library-actions.ts';
import {MoreButton, type OpenMenu} from './MoreButton.tsx';

/**
 * How deep the tree indents before it stops.
 *
 * Groups nest arbitrarily, but a 200-pixel panel runs out of room long before
 * a writer runs out of folders. Past this depth everything renders at the same
 * indent and a group carries the rest of its path in its label, so a deeply
 * buried group is cramped rather than unreachable.
 */
export const MAX_DEPTH = 2;

/**
 * Whether a group's contents step in under its header.
 *
 * True down to [`MAX_DEPTH`]; below that the contents share their header's
 * indent, so everything deeper sits at the last one.
 */
export function nestsContents(group: string): boolean {
  return group.split('/').length - 1 <= MAX_DEPTH;
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

/**
 * A section header's look, shared with the ungrouped section: a folder name in
 * the same case and size as the documents under it.
 */
export const SECTION_HEADER =
  'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-ink-300 transition-colors duration-100 group-hover/row:bg-ink-800 group-hover/row:text-ink-100';

/**
 * The list under a header: one step in, with a guide line under the header's
 * chevron. The two numbers put the line under the chevron's middle and the
 * contents' text under the header's name.
 */
export const NESTED = 'ml-[13px] space-y-px border-l border-ink-800 pl-1';

const FLAT = 'space-y-px';

type GroupRowProps = {
  node: GroupNode;
  openPath: DocPath | undefined;
  /** Group paths the writer has folded shut. Everything else is open. */
  collapsed: readonly string[];
  /** Which row's menu is up, as `targetKey` names it. */
  menuKey: string | undefined;
  onToggle: (group: GroupPath) => void;
  onOpen: (path: DocPath) => void;
  onMenu: OpenMenu;
};

/** One group, its documents, and every group below it. */
export const GroupRow = memo(function GroupRow({
  node,
  openPath,
  collapsed,
  menuKey,
  onToggle,
  onOpen,
  onMenu,
}: GroupRowProps) {
  const open = !collapsed.includes(node.path);
  const Chevron = open ? ChevronDown : ChevronRight;
  const more = useRef<HTMLButtonElement>(null);
  const target = useMemo(
    function (): Target {
      return {kind: 'group', group: node.path};
    },
    [node.path],
  );
  const menuOpen = menuKey === targetKey(target);

  const handleToggle = useCallback(
    function () {
      onToggle(node.path);
    },
    [node.path, onToggle],
  );

  const handleContextMenu = useCallback(
    function (event: MouseEvent) {
      event.preventDefault();
      if (more.current !== null) onMenu(target, {x: event.clientX, y: event.clientY}, more.current);
    },
    [target, onMenu],
  );

  const label = labelOf(node.path);

  return (
    <li>
      <div className="group/row relative" onContextMenu={handleContextMenu}>
        <button
          type="button"
          aria-expanded={open}
          onClick={handleToggle}
          className={SECTION_HEADER}
        >
          <Chevron size={12} className="shrink-0 text-ink-600" aria-hidden />
          <span className="truncate">{label}</span>
        </button>
        <MoreButton
          ref={more}
          label={`Actions for the group ${label}`}
          target={target}
          shown={menuOpen}
          expanded={menuOpen}
          rowActive={false}
          onMenu={onMenu}
        />
      </div>

      {open && (
        <ul className={nestsContents(node.path) ? NESTED : FLAT}>
          {node.docs.map(function (doc) {
            return (
              <li key={doc.path}>
                <DocRow
                  doc={doc}
                  active={doc.path === openPath}
                  menuOpen={menuKey === targetKey({kind: 'doc', doc})}
                  onOpen={onOpen}
                  onMenu={onMenu}
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
                collapsed={collapsed}
                menuKey={menuKey}
                onToggle={onToggle}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
});

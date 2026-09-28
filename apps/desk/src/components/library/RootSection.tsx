import {memo} from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type {DocPath, DocSummary} from '@inkling/vault';
import {DocRow} from './DocRow.tsx';
import {NESTED, SECTION_HEADER} from './GroupRow.tsx';
import {targetKey} from './library-actions.ts';
import type {OpenMenu} from './MoreButton.tsx';

type RootSectionProps = {
  docs: readonly DocSummary[];
  openPath: DocPath | undefined;
  open: boolean;
  /** Which row's menu is up, as `targetKey` names it. */
  menuKey: string | undefined;
  onToggle: () => void;
  onOpen: (path: DocPath) => void;
  onMenu: OpenMenu;
};

/**
 * The documents at the vault root, in a section of their own.
 *
 * It looks like a group and is not one. The root is where a rule set governs
 * every document rather than one folder's worth, which is why `docs/model.md`
 * keeps Root and Group as separate rows, and why this collapses on its own flag
 * rather than on a sentinel wedged into the list of collapsed group paths. It
 * has no ⋯ for the same reason: there is nothing to rename or delete, and the
 * library header's `+` already makes things here.
 */
export const RootSection = memo(function RootSection({
  docs,
  openPath,
  open,
  menuKey,
  onToggle,
  onOpen,
  onMenu,
}: RootSectionProps) {
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <div className="group/row">
        <button type="button" aria-expanded={open} onClick={onToggle} className={SECTION_HEADER}>
          <Chevron size={12} className="shrink-0 text-ink-600" aria-hidden />
          <span className="truncate">No group</span>
        </button>
      </div>

      {open && (
        <ul className={NESTED}>
          {docs.map(function (doc) {
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
        </ul>
      )}
    </li>
  );
});

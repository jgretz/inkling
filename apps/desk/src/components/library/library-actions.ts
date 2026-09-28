import {match} from 'ts-pattern';
import {
  groupName,
  groupOf,
  movedTo,
  parentGroup,
  type DocPath,
  type DocSummary,
  type GroupPath,
} from '@inkling/vault';

/** What a menu acts on: a document row, a group header, or the library's own header. */
export type Target =
  {kind: 'doc'; doc: DocSummary} | {kind: 'group'; group: GroupPath} | {kind: 'header'};

/** An edit that needs the writer to type or pick something before it can run. */
export type Modal =
  | {kind: 'renameDoc'; doc: DocSummary}
  | {kind: 'renameGroup'; group: GroupPath}
  | {kind: 'moveDoc'; doc: DocSummary}
  | {kind: 'newDoc'; group: GroupPath | undefined}
  | {kind: 'newGroup'};

/**
 * What picking a menu item does. A delete needs no input here, because its
 * confirmation is `App.tsx`'s; everything else opens a modal.
 */
export type Command =
  Modal | {kind: 'deleteDoc'; doc: DocSummary} | {kind: 'deleteGroup'; group: GroupPath};

/**
 * One menu entry, already bound to the row it was raised on, so no pairing of
 * an action with a target the menu never offers can reach the handler.
 */
export type MenuItem = {label: string; command: Command};

/**
 * The one menu or modal the library has open, if any.
 *
 * One value rather than a flag per surface: picking a menu item swaps the menu
 * for a modal, and two flags would let both be up at once. Every surface
 * carries `trigger`, the ⋯ or `+` it was raised from, which is where the caret
 * goes back to when it closes.
 */
export type Surface =
  | {kind: 'menu'; target: Target; at: {x: number; y: number}; trigger: HTMLElement}
  | (Modal & {trigger: HTMLElement});

/** What the menu offers for a target. Delete is last, furthest from the row. */
export function menuItemsFor(target: Target): readonly MenuItem[] {
  return match(target)
    .with({kind: 'doc'}, function ({doc}): MenuItem[] {
      return [
        {label: 'Rename…', command: {kind: 'renameDoc', doc}},
        {label: 'Move to…', command: {kind: 'moveDoc', doc}},
        {label: 'Delete', command: {kind: 'deleteDoc', doc}},
      ];
    })
    .with({kind: 'group'}, function ({group}): MenuItem[] {
      return [
        {label: 'New document…', command: {kind: 'newDoc', group}},
        {label: 'Rename…', command: {kind: 'renameGroup', group}},
        {label: 'Delete', command: {kind: 'deleteGroup', group}},
      ];
    })
    .with({kind: 'header'}, function (): MenuItem[] {
      return [
        {label: 'New document…', command: {kind: 'newDoc', group: undefined}},
        {label: 'New group…', command: {kind: 'newGroup'}},
      ];
    })
    .exhaustive();
}

/**
 * Names the row a menu belongs to, so the row can say its menu is open
 * without the panel handing a DOM element down the tree.
 */
export function targetKey(target: Target): string {
  return match(target)
    .with({kind: 'doc'}, function ({doc}) {
      return `doc:${doc.path}`;
    })
    .with({kind: 'group'}, function ({group}) {
      return `group:${group}`;
    })
    .with({kind: 'header'}, function () {
      return 'header';
    })
    .exhaustive();
}

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
 * Where a document goes when it is renamed to `title`: the same group, under
 * the filename the title slugs to. `undefined` when the title is empty or slugs
 * to the file it already is, so there is nothing to do.
 */
export function renamedDoc(path: DocPath, title: string): DocPath | undefined {
  const trimmed = title.trim();
  if (trimmed.length === 0) return undefined;
  const next = movedTo(fileNameFor(trimmed), groupOf(path));
  return next === path ? undefined : next;
}

/**
 * Where a group goes when its last segment is renamed to `name`.
 *
 * Only the last segment is editable, so a rename stays a rename: moving a group
 * somewhere else is a different gesture the library does not offer.
 * `undefined` when the name is empty or unchanged.
 */
export function renamedGroup(group: GroupPath, name: string): GroupPath | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed === groupName(group)) return undefined;
  const parent = parentGroup(group);
  return (parent === undefined ? trimmed : `${parent}/${trimmed}`) as GroupPath;
}

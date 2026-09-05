import type {DocPath, DocSummary, GroupPath} from './types.ts';

/**
 * Groups, which are directories.
 *
 * There is no group table, no group id and no membership to maintain: a
 * document's group is the directory portion of its path, and the hierarchy is
 * whatever the writer's own folders already say. Everything here is therefore a
 * function over strings and summaries, with no filesystem in sight, the way the
 * voice cascade's ancestor walk already is.
 *
 * Segment boundaries are the one rule to hold on to. A group named `drafts` and
 * a group named `drafts2` share five characters and nothing else, so every
 * prefix test below compares whole segments.
 */

/** One group and everything directly inside it. */
export type GroupNode = {
  path: GroupPath;
  /** The last segment, which is what the writer named it. */
  name: string;
  /** Documents in this directory itself, not in the ones below it. */
  docs: DocSummary[];
  children: GroupNode[];
};

/** The vault as the library shows it: ungrouped documents, then the groups. */
export type GroupTree = {
  root: DocSummary[];
  groups: GroupNode[];
};

/** The group a document sits in, or `undefined` for one at the vault root. */
export function groupOf(path: string): GroupPath | undefined {
  const cut = path.lastIndexOf('/');
  if (cut < 0) return undefined;
  return path.slice(0, cut) as GroupPath;
}

/** The last segment of a group path, which is what the writer named it. */
export function groupName(group: string): string {
  return group.split('/').filter(Boolean).pop() ?? group;
}

/** The group holding this one, or `undefined` for one at the vault root. */
export function parentGroup(group: string): GroupPath | undefined {
  return groupOf(group);
}

/** Where a document lands when it moves into a group, or out to the root. */
export function movedTo(path: string, group: GroupPath | undefined): DocPath {
  const name = path.split('/').pop() ?? path;
  return (group === undefined || group === '' ? name : `${group}/${name}`) as DocPath;
}

/**
 * Rewrites a path that sits under the group `from` so it sits under `to`.
 *
 * Anything not under `from` comes back untouched, and "under" means whole
 * segments: renaming `drafts` leaves `drafts2/a.md` exactly where it is. The
 * group path itself moves too, so this works on a document path and on a
 * nested group path alike.
 */
export function rewriteUnder(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (!path.startsWith(`${from}/`)) return path;
  return `${to}${path.slice(from.length)}`;
}

/** Every ancestor of a group, the shallowest first, the group itself last. */
function selfAndAncestors(group: string): string[] {
  return group.split('/').reduce<string[]>(function (paths, segment) {
    const parent = paths[paths.length - 1];
    return [...paths, parent === undefined ? segment : `${parent}/${segment}`];
  }, []);
}

/**
 * Every group containing a path, the shallowest first and the nearest last.
 *
 * The empty array for a path at the vault root, because the root is not a
 * group: `GroupPath` is never the empty string, and the levels that cascade
 * onto a document are the real directories above it and nothing else. That is
 * the one way this differs from the voice cascade's `ancestorDirs`, which does
 * start at the root because a `voice.md` may sit there.
 *
 * Works on a document path and on a group path alike: the group's own path is
 * the directory portion of a document's, and a nested group's ancestors are the
 * directories above it.
 */
export function ancestorGroups(path: string): GroupPath[] {
  const group = groupOf(path);
  if (group === undefined) return [];
  return selfAndAncestors(group) as GroupPath[];
}

/**
 * Builds the tree the library renders.
 *
 * `groups` is what the vault scan found on disk, so a group the writer just
 * made and put nothing in still appears. A directory that holds no documents of
 * its own but sits above one that does appears as well, because dropping it
 * would leave its children with nowhere to hang.
 *
 * Document order within a group is the order handed in, which is the
 * most-recently-touched-first order the workspace already sorts into.
 */
export function groupTree(
  docs: readonly DocSummary[],
  groups: readonly GroupPath[] = [],
): GroupTree {
  const nodes = new Map<string, GroupNode>();

  function ensure(group: string): GroupNode {
    const existing = nodes.get(group);
    if (existing !== undefined) return existing;
    const node: GroupNode = {
      path: group as GroupPath,
      name: groupName(group),
      docs: [],
      children: [],
    };
    nodes.set(group, node);
    return node;
  }

  const root: DocSummary[] = [];
  const declared = [
    ...groups,
    ...docs.flatMap(function (doc) {
      const group = groupOf(doc.path);
      return group === undefined ? [] : [group];
    }),
  ];

  declared.forEach(function (group) {
    selfAndAncestors(group).forEach(ensure);
  });

  docs.forEach(function (doc) {
    const group = groupOf(doc.path);
    if (group === undefined) root.push(doc);
    else ensure(group).docs.push(doc);
  });

  const top: GroupNode[] = [];
  const byName = function (a: GroupNode, b: GroupNode) {
    return a.name.localeCompare(b.name);
  };

  [...nodes.keys()].sort().forEach(function (group) {
    const node = ensure(group);
    const parent = parentGroup(group);
    if (parent === undefined) top.push(node);
    else ensure(parent).children.push(node);
  });

  nodes.forEach(function (node) {
    node.children.sort(byName);
  });

  return {root, groups: top.sort(byName)};
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * Case-insensitive match against a document's names: its title, its filename
 * and its tags.
 *
 * Deliberately not the whole path. Every document under a group carries that
 * group's name in its path, so matching on the path would make every document
 * in a matching group match on its own, and the rule below about a group whose
 * own name matches would decide nothing it does not already decide.
 */
function matchesDoc(doc: DocSummary, needle: string): boolean {
  const fileName = doc.path.split('/').pop() ?? doc.path;
  return matches([doc.title, fileName, ...doc.tags].join(' '), needle);
}

function filterNode(node: GroupNode, needle: string): GroupNode | undefined {
  // A group whose own name matches keeps everything inside it: the writer asked
  // for the group, not for a document, and hiding its contents would answer a
  // question they did not ask.
  if (matches(node.name, needle)) return node;

  const docs = node.docs.filter(function (doc) {
    return matchesDoc(doc, needle);
  });
  const children = node.children.flatMap(function (child) {
    const kept = filterNode(child, needle);
    return kept === undefined ? [] : [kept];
  });

  if (docs.length === 0 && children.length === 0) return undefined;
  return {...node, docs, children};
}

/**
 * Narrows the tree to what a query names.
 *
 * Two rules, and the difference between them is the point. A group whose own
 * name matches keeps all of its documents. A group that merely *contains* a
 * match keeps only the documents that matched, and is kept itself so the ones
 * that did survive still have a group to sit in.
 */
export function filterTree(tree: GroupTree, query: string): GroupTree {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return tree;

  return {
    root: tree.root.filter(function (doc) {
      return matchesDoc(doc, needle);
    }),
    groups: tree.groups.flatMap(function (node) {
      const kept = filterNode(node, needle);
      return kept === undefined ? [] : [kept];
    }),
  };
}

import {describe, expect, it} from 'bun:test';
import {
  filterTree,
  groupName,
  groupOf,
  groupTree,
  movedTo,
  parentGroup,
  rewriteUnder,
} from '../src/groups.ts';
import type {DocPath, DocSummary, GroupPath} from '../src/types.ts';

/** A summary with only the fields the group logic reads set to anything real. */
function doc(path: string, title: string = path, tags: string[] = []): DocSummary {
  return {
    path: path as DocPath,
    title,
    kind: undefined,
    tags,
    updatedAt: '2026-09-04T12:00:00.000Z',
    words: 100,
  };
}

function groups(...paths: string[]): GroupPath[] {
  return paths as GroupPath[];
}

/** Every group in the tree by path, parents before children. */
function pathsIn(tree: ReturnType<typeof groupTree>): string[] {
  return tree.groups.flatMap(function walk(node): string[] {
    return [node.path, ...node.children.flatMap(walk)];
  });
}

describe('groupOf', function () {
  it('should return the directory portion of a nested path', function () {
    expect(groupOf('drafts/2026/a.md')).toBe('drafts/2026' as GroupPath);
  });

  it('should return undefined for a document at the vault root', function () {
    expect(groupOf('a.md')).toBeUndefined();
  });
});

describe('groupName', function () {
  it('should return the last segment of a nested group', function () {
    expect(groupName('drafts/2026')).toBe('2026');
  });

  it('should return the whole path for a top-level group', function () {
    expect(groupName('drafts')).toBe('drafts');
  });
});

describe('parentGroup', function () {
  it('should return the group above a nested one', function () {
    expect(parentGroup('drafts/2026/notes')).toBe('drafts/2026' as GroupPath);
  });

  it('should return undefined for a top-level group', function () {
    expect(parentGroup('drafts')).toBeUndefined();
  });
});

describe('movedTo', function () {
  it('should keep the filename and change the group', function () {
    expect(movedTo('drafts/a.md', 'essays/2026' as GroupPath)).toBe('essays/2026/a.md' as DocPath);
  });

  it('should move a document out to the vault root', function () {
    expect(movedTo('drafts/a.md', undefined)).toBe('a.md' as DocPath);
  });
});

describe('rewriteUnder', function () {
  it('should move a document under the renamed group', function () {
    expect(rewriteUnder('drafts/a.md', 'drafts', 'essays')).toBe('essays/a.md');
  });

  it('should move a document nested below the renamed group', function () {
    expect(rewriteUnder('drafts/2026/a.md', 'drafts', 'essays')).toBe('essays/2026/a.md');
  });

  it('should move the renamed group itself', function () {
    expect(rewriteUnder('drafts', 'drafts', 'essays')).toBe('essays');
  });

  it('should leave a sibling whose name merely starts the same alone', function () {
    expect(rewriteUnder('drafts2/a.md', 'drafts', 'essays')).toBe('drafts2/a.md');
  });

  it('should leave a path outside the renamed group alone', function () {
    expect(rewriteUnder('notes/a.md', 'drafts', 'essays')).toBe('notes/a.md');
  });
});

describe('groupTree', function () {
  it('should keep a document at the vault root out of every group', function () {
    const tree = groupTree([doc('a.md'), doc('drafts/b.md')]);

    expect(tree.root.map((entry) => entry.path)).toEqual(['a.md' as DocPath]);
    expect(tree.groups.length).toBe(1);
    expect(tree.groups[0]?.docs.map((entry) => entry.path)).toEqual(['drafts/b.md' as DocPath]);
  });

  it('should nest a group below its parent rather than at the top level', function () {
    const tree = groupTree([doc('drafts/2026/a.md')]);

    expect(tree.groups.map((node) => node.path)).toEqual(['drafts' as GroupPath]);
    expect(tree.groups[0]?.children.map((node) => node.path)).toEqual(['drafts/2026' as GroupPath]);
  });

  it('should keep an intermediate group that holds no documents of its own', function () {
    const tree = groupTree([doc('drafts/2026/a.md')]);

    expect(tree.groups[0]?.docs).toEqual([]);
    expect(pathsIn(tree)).toEqual(['drafts', 'drafts/2026']);
  });

  it('should show a group the writer made and put nothing in yet', function () {
    const tree = groupTree([doc('a.md')], groups('essays'));

    expect(pathsIn(tree)).toEqual(['essays']);
    expect(tree.groups[0]?.docs).toEqual([]);
  });

  it('should nest arbitrarily deep', function () {
    const tree = groupTree([doc('a/b/c/d/e.md')]);

    expect(pathsIn(tree)).toEqual(['a', 'a/b', 'a/b/c', 'a/b/c/d']);
  });

  it('should name each group by its last segment', function () {
    const tree = groupTree([], groups('drafts/2026'));

    expect(tree.groups[0]?.name).toBe('drafts');
    expect(tree.groups[0]?.children[0]?.name).toBe('2026');
  });
});

describe('filterTree', function () {
  const tree = groupTree([
    doc('a.md', 'Root piece'),
    doc('drafts/one.md', 'On writing'),
    doc('drafts/two.md', 'Something else'),
    doc('essays/three.md', 'A draft of nothing'),
  ]);

  it('should return the tree untouched for an empty query', function () {
    expect(filterTree(tree, '   ')).toBe(tree);
  });

  it('should keep every document in a group whose own name matches', function () {
    const filtered = filterTree(tree, 'drafts');
    const drafts = filtered.groups.find((node) => node.path === ('drafts' as GroupPath));

    expect(drafts?.docs.map((entry) => entry.title)).toEqual(['On writing', 'Something else']);
  });

  it('should keep only the matching documents in a group that merely contains one', function () {
    const filtered = filterTree(tree, 'draft of');
    const essays = filtered.groups.find((node) => node.path === ('essays' as GroupPath));

    expect(essays?.docs.map((entry) => entry.title)).toEqual(['A draft of nothing']);
    expect(filtered.groups.map((node) => node.path)).toEqual(['essays' as GroupPath]);
  });

  it('should keep a document whose filename matches even when its title does not', function () {
    const named = groupTree([doc('drafts/on-endings.md', 'Untitled')]);

    const filtered = filterTree(named, 'on-endings');

    expect(filtered.groups[0]?.docs.map((entry) => entry.title)).toEqual(['Untitled']);
  });

  it('should keep an empty group whose own name matches', function () {
    const empty = groupTree([], groups('essays'));

    expect(pathsIn(filterTree(empty, 'essays'))).toEqual(['essays']);
  });

  it('should not match a document on the group portion of its path', function () {
    // Were the whole path in the haystack, the group-name rule above would
    // decide nothing: every document under a matching group would match on its
    // own. `drafts/2026` is a substring of this document's path and of no
    // group's name, so only a path match could keep it.
    const nested = groupTree([doc('drafts/2026/a.md', 'Buried')]);

    expect(filterTree(nested, 'drafts/2026').groups).toEqual([]);
  });

  it('should drop a group with nothing matching in it', function () {
    const filtered = filterTree(tree, 'something else');

    expect(filtered.groups.map((node) => node.path)).toEqual(['drafts' as GroupPath]);
    expect(filtered.root).toEqual([]);
  });

  it('should keep a matching document at the vault root', function () {
    const filtered = filterTree(tree, 'root piece');

    expect(filtered.root.map((entry) => entry.title)).toEqual(['Root piece']);
    expect(filtered.groups).toEqual([]);
  });

  it('should keep a parent group so a matching document below it still has one', function () {
    const nested = groupTree([doc('drafts/2026/deep.md', 'Buried')]);

    const filtered = filterTree(nested, 'buried');

    expect(pathsIn(filtered)).toEqual(['drafts', 'drafts/2026']);
  });
});

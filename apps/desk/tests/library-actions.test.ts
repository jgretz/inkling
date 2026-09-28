import {describe, expect, it} from 'bun:test';
import type {DocPath, DocSummary, GroupPath} from '@inkling/vault';
import {
  fileNameFor,
  menuItemsFor,
  renamedDoc,
  renamedGroup,
  targetKey,
} from '../src/components/library/library-actions.ts';

const DOC: DocSummary = {
  path: 'drafts/one.md' as DocPath,
  title: 'On writing',
  kind: undefined,
  tags: [],
  updatedAt: '2026-09-04T12:00:00.000Z',
  words: 100,
};

function labels(items: ReturnType<typeof menuItemsFor>): string[] {
  return items.map(function (item) {
    return item.label;
  });
}

describe('menuItemsFor', function () {
  it('should bind every document item to the document when the target is a document', function () {
    const items = menuItemsFor({kind: 'doc', doc: DOC});

    expect(labels(items)).toEqual(['Rename…', 'Move to…', 'Delete']);
    expect(
      items.map(function (item) {
        return item.command;
      }),
    ).toEqual([
      {kind: 'renameDoc', doc: DOC},
      {kind: 'moveDoc', doc: DOC},
      {kind: 'deleteDoc', doc: DOC},
    ]);
  });

  it('should create inside the group when the target is a group', function () {
    const items = menuItemsFor({kind: 'group', group: 'drafts' as GroupPath});

    expect(labels(items)).toEqual(['New document…', 'Rename…', 'Delete']);
    expect(items[0]?.command).toEqual({kind: 'newDoc', group: 'drafts' as GroupPath});
  });

  it('should create at the vault root when the target is the header', function () {
    const items = menuItemsFor({kind: 'header'});

    expect(labels(items)).toEqual(['New document…', 'New group…']);
    expect(items[0]?.command).toEqual({kind: 'newDoc', group: undefined});
  });
});

describe('targetKey', function () {
  it('should tell a document from a group when the two share a path', function () {
    const asDoc = targetKey({kind: 'doc', doc: {...DOC, path: 'drafts' as DocPath}});
    const asGroup = targetKey({kind: 'group', group: 'drafts' as GroupPath});

    expect(asDoc).not.toBe(asGroup);
  });
});

describe('fileNameFor', function () {
  it('should slug a title into a markdown filename when it has punctuation', function () {
    expect(fileNameFor('On Writing, With an Agent')).toBe('on-writing-with-an-agent.md');
  });

  it('should fall back to untitled when nothing survives slugging', function () {
    expect(fileNameFor('!!!')).toBe('untitled.md');
  });
});

describe('renamedDoc', function () {
  it('should keep the document in its group when it is renamed', function () {
    expect(renamedDoc('drafts/one.md' as DocPath, 'Second thoughts')).toBe(
      'drafts/second-thoughts.md' as DocPath,
    );
  });

  it('should keep a root document at the root when it is renamed', function () {
    expect(renamedDoc('one.md' as DocPath, 'Two')).toBe('two.md' as DocPath);
  });

  it('should return nothing when the title slugs to the file it already is', function () {
    expect(renamedDoc('drafts/on-writing.md' as DocPath, 'On Writing')).toBeUndefined();
  });

  it('should return nothing when the title is blank', function () {
    expect(renamedDoc('drafts/one.md' as DocPath, '   ')).toBeUndefined();
  });
});

describe('renamedGroup', function () {
  it('should keep a nested group under its parent when it is renamed', function () {
    expect(renamedGroup('drafts/2026' as GroupPath, '2027')).toBe('drafts/2027' as GroupPath);
  });

  it('should rename a top-level group in place when it has no parent', function () {
    expect(renamedGroup('drafts' as GroupPath, 'notes')).toBe('notes' as GroupPath);
  });

  it('should rename only the last segment when the group is deep', function () {
    expect(renamedGroup('a/b/c/d' as GroupPath, 'e')).toBe('a/b/c/e' as GroupPath);
  });

  it('should return nothing when the name is unchanged or blank', function () {
    expect(renamedGroup('drafts/2026' as GroupPath, ' 2026 ')).toBeUndefined();
    expect(renamedGroup('drafts/2026' as GroupPath, '')).toBeUndefined();
  });
});

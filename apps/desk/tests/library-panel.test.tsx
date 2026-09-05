import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import type {DocPath, DocSummary, GroupPath} from '@inkling/vault';
import {fileNameFor, LibraryPanel} from '../src/components/library/LibraryPanel.tsx';
import {relativeTime} from '../src/components/library/DocRow.tsx';
import {indentOf, labelOf} from '../src/components/library/GroupRow.tsx';

autoCleanup();

function doc(path: string, title: string): DocSummary {
  return {
    path: path as DocPath,
    title,
    kind: undefined,
    tags: [],
    updatedAt: '2026-09-04T12:00:00.000Z',
    words: 100,
  };
}

const DOCS = [
  doc('a.md', 'Root piece'),
  doc('drafts/one.md', 'On writing'),
  doc('drafts/two.md', 'Something else'),
  doc('essays/three.md', 'A draft of nothing'),
];

function noop() {}

function panel(overrides: Partial<Parameters<typeof LibraryPanel>[0]> = {}) {
  return render(
    <LibraryPanel
      docs={DOCS}
      groups={['drafts', 'essays'] as GroupPath[]}
      openPath={undefined}
      vaultName="vault"
      onOpen={noop}
      onChooseVault={noop}
      onCreateGroup={noop}
      onRenameGroup={noop}
      onMoveDoc={noop}
      onCreateDoc={noop}
      {...overrides}
    />,
  );
}

/**
 * A group header, found by the label on the row's rename control rather than by
 * its text: every document's "Move to" select carries an option per group, so
 * a group's name is on screen once per row as well as on its header.
 */
function header(view: ReturnType<typeof panel>, group: string): HTMLElement {
  const row = view.getByLabelText(`Rename the group ${group}`).closest('li');
  const found = row?.querySelector('button[aria-expanded]');
  if (!(found instanceof HTMLElement)) throw new Error(`no header for the group ${group}`);
  return found;
}

/** The list item wrapping a whole group, header and contents alike. */
function section(view: ReturnType<typeof panel>, group: string): HTMLElement {
  const row = view.getByLabelText(`Rename the group ${group}`).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`no section for the group ${group}`);
  return row;
}

describe('LibraryPanel', function () {
  it('should render a document inside its group and not at the top level', function () {
    const view = panel();

    const row = view.getByText('On writing');

    expect(section(view, 'drafts').contains(row)).toBe(true);
    // Not a sibling of the groups: the flat list this replaced put it there.
    expect(section(view, 'essays').contains(row)).toBe(false);
  });

  it('should render a document at the vault root in the ungrouped section', function () {
    const view = panel();

    const row = view.getByText('Root piece');

    expect(section(view, 'drafts').contains(row)).toBe(false);
    expect(view.getByRole('button', {name: 'No group'}).closest('li')?.contains(row)).toBe(true);
  });

  it('should show a group the writer made and put nothing in yet', function () {
    const view = panel({docs: [], groups: ['essays'] as GroupPath[]});

    expect(view.queryByText('No documents yet')).toBeNull();
    expect(header(view, 'essays')).toBeDefined();
  });

  it('should keep every document in a group whose own name matches the filter', function () {
    const {getByLabelText, getByText, queryByText} = panel();

    fireEvent.change(getByLabelText('Search documents'), {target: {value: 'drafts'}});

    expect(getByText('On writing')).toBeDefined();
    expect(getByText('Something else')).toBeDefined();
    expect(queryByText('A draft of nothing')).toBeNull();
  });

  it('should keep only the matching document in a group that merely contains one', function () {
    const {getByLabelText, getByText, queryByText} = panel();

    fireEvent.change(getByLabelText('Search documents'), {target: {value: 'draft of'}});

    expect(getByText('A draft of nothing')).toBeDefined();
    expect(queryByText('On writing')).toBeNull();
    expect(queryByText('Something else')).toBeNull();
  });

  it('should hide a collapsed group’s documents and leave the ungrouped section open', function () {
    const view = panel();

    fireEvent.click(header(view, 'drafts'));

    expect(view.queryByText('On writing')).toBeNull();
    expect(view.getByText('Root piece')).toBeDefined();
    expect(view.getByText('A draft of nothing')).toBeDefined();
  });

  it('should hide the ungrouped documents without touching the groups', function () {
    const view = panel();

    fireEvent.click(view.getByRole('button', {name: 'No group'}));

    expect(view.queryByText('Root piece')).toBeNull();
    expect(view.getByText('On writing')).toBeDefined();
  });

  it('should open a document when its row is clicked', function () {
    const onOpen = mock(function () {});
    const {getByText} = panel({onOpen});

    fireEvent.click(getByText('On writing'));

    expect(onOpen).toHaveBeenCalledWith('drafts/one.md' as DocPath);
  });

  it('should make a group from what is typed into the inline field', function () {
    const onCreateGroup = mock(function () {});
    const {getByLabelText} = panel({onCreateGroup});

    fireEvent.click(getByLabelText('New group'));
    const field = getByLabelText('Name of the new group');
    fireEvent.change(field, {target: {value: 'notes'}});
    fireEvent.submit(field);

    expect(onCreateGroup).toHaveBeenCalledWith('notes' as GroupPath);
  });

  it('should rename a group under the same parent', function () {
    const onRenameGroup = mock(function () {});
    const {getByLabelText} = panel({
      docs: [doc('drafts/2026/a.md', 'Buried')],
      groups: ['drafts', 'drafts/2026'] as GroupPath[],
      onRenameGroup,
    });

    fireEvent.click(getByLabelText('Rename the group 2026'));
    const field = getByLabelText('Rename the group 2026');
    fireEvent.change(field, {target: {value: '2027'}});
    fireEvent.submit(field);

    expect(onRenameGroup).toHaveBeenCalledWith(
      'drafts/2026' as GroupPath,
      'drafts/2027' as GroupPath,
    );
  });

  it('should move a document into the group picked on its row', function () {
    const onMoveDoc = mock(function () {});
    const {getByLabelText} = panel({onMoveDoc});

    fireEvent.change(getByLabelText('Move On writing to a group'), {target: {value: 'essays'}});

    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'essays/one.md' as DocPath);
  });

  it('should move a document out to the vault root', function () {
    const onMoveDoc = mock(function () {});
    const {getByLabelText} = panel({onMoveDoc});

    fireEvent.change(getByLabelText('Move On writing to a group'), {target: {value: ''}});

    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'one.md' as DocPath);
  });

  it('should create a new document inside the group it was asked for', function () {
    const onCreateDoc = mock(function () {});
    const {getByLabelText} = panel({onCreateDoc});

    fireEvent.click(getByLabelText('New document in drafts'));
    const field = getByLabelText('Title of the new document in drafts');
    fireEvent.change(field, {target: {value: 'On Endings'}});
    fireEvent.submit(field);

    expect(onCreateDoc).toHaveBeenCalledWith('drafts/on-endings.md' as DocPath, 'On Endings');
  });

  it('should create a new document at the vault root', function () {
    const onCreateDoc = mock(function () {});
    const {getByLabelText} = panel({onCreateDoc});

    fireEvent.click(getByLabelText('New document'));
    const field = getByLabelText('Title of the new document');
    fireEvent.change(field, {target: {value: 'On Endings'}});
    fireEvent.submit(field);

    expect(onCreateDoc).toHaveBeenCalledWith('on-endings.md' as DocPath, 'On Endings');
  });

  it('should cancel rather than create when the field is submitted empty', function () {
    const onCreateGroup = mock(function () {});
    const {getByLabelText, queryByLabelText} = panel({onCreateGroup});

    fireEvent.click(getByLabelText('New group'));
    fireEvent.submit(getByLabelText('Name of the new group'));

    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(queryByLabelText('Name of the new group')).toBeNull();
  });

  it('should say nothing matches rather than that the vault is empty', function () {
    const {getByLabelText, getByText} = panel();

    fireEvent.change(getByLabelText('Search documents'), {target: {value: 'nothing here'}});

    expect(getByText('Nothing matches')).toBeDefined();
  });
});

describe('relativeTime', function () {
  const now = Date.parse('2026-09-04T12:00:00.000Z');

  it('should say "just now" under a minute', function () {
    expect(relativeTime('2026-09-04T11:59:40.000Z', now)).toBe('just now');
  });

  it('should count minutes under an hour', function () {
    expect(relativeTime('2026-09-04T11:20:00.000Z', now)).toBe('40m');
  });

  it('should count hours under a day', function () {
    expect(relativeTime('2026-09-04T04:00:00.000Z', now)).toBe('8h');
  });

  it('should count days under a week', function () {
    expect(relativeTime('2026-09-01T12:00:00.000Z', now)).toBe('3d');
  });

  it('should fall back to a date past a week', function () {
    expect(relativeTime('2026-07-01T12:00:00.000Z', now)).not.toMatch(/^\d+[mhd]$/);
  });

  it('should return an empty string for a timestamp it cannot read', function () {
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('fileNameFor', function () {
  it('should slug a title into a markdown filename', function () {
    expect(fileNameFor('On Writing, With an Agent')).toBe('on-writing-with-an-agent.md');
  });

  it('should fall back to untitled when nothing survives slugging', function () {
    expect(fileNameFor('!!!')).toBe('untitled.md');
  });
});

describe('GroupRow paths', function () {
  it('should indent each level until the third and then stop', function () {
    expect(indentOf('a')).toBe(0);
    expect(indentOf('a/b')).toBeGreaterThan(0);
    expect(indentOf('a/b/c')).toBeGreaterThan(0);
    expect(indentOf('a/b/c/d')).toBe(0);
  });

  it('should label a group past the last indent with enough path to place it', function () {
    expect(labelOf('a/b/c')).toBe('c');
    expect(labelOf('a/b/c/d')).toBe('c/d');
    expect(labelOf('a/b/c/d/e')).toBe('c/d/e');
  });
});

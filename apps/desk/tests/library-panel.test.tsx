import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import type {DocPath, DocSummary, GroupPath} from '@inkling/vault';
import {LibraryPanel} from '../src/components/library/LibraryPanel.tsx';
import {labelOf, nestsContents} from '../src/components/library/GroupRow.tsx';

autoCleanup();

function doc(path: string, title: string, updatedAt = '2026-09-04T12:00:00.000Z'): DocSummary {
  return {
    path: path as DocPath,
    title,
    kind: undefined,
    tags: [],
    updatedAt,
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
      onDeleteDoc={noop}
      onDeleteGroup={noop}
      {...overrides}
    />,
  );
}

type View = ReturnType<typeof panel>;

/** A group's header, which is the button named by the folder. */
function header(view: View, group: string): HTMLElement {
  return view.getByRole('button', {name: group});
}

/** The list item wrapping a whole group, header and contents alike. */
function section(view: View, group: string): HTMLElement {
  const row = header(view, group).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`no section for the group ${group}`);
  return row;
}

function more(view: View, title: string): HTMLElement {
  return view.getByRole('button', {name: `Actions for ${title}`});
}

function groupMore(view: View, group: string): HTMLElement {
  return view.getByRole('button', {name: `Actions for the group ${group}`});
}

function menuLabels(view: View): (string | null)[] {
  return view.getAllByRole('menuitem').map(function (item) {
    return item.textContent;
  });
}

/** Opens a menu from its trigger and picks one of its items. */
function pick(view: View, opener: HTMLElement, item: string) {
  fireEvent.click(opener);
  fireEvent.click(view.getByRole('menuitem', {name: item}));
}

function submitField(view: View, label: string, value: string) {
  const field = view.getByLabelText(label);
  fireEvent.change(field, {target: {value}});
  fireEvent.submit(field);
}

describe('LibraryPanel tree', function () {
  it('should render a document inside its group when it sits in that directory', function () {
    const view = panel();

    const row = view.getByText('On writing');

    expect(section(view, 'drafts').contains(row)).toBe(true);
    expect(section(view, 'essays').contains(row)).toBe(false);
  });

  it('should render a document in the ungrouped section when it sits at the vault root', function () {
    const view = panel();

    const row = view.getByText('Root piece');

    expect(section(view, 'drafts').contains(row)).toBe(false);
    expect(section(view, 'No group').contains(row)).toBe(true);
  });

  it('should show a group when the writer made it and put nothing in it yet', function () {
    const view = panel({docs: [], groups: ['essays'] as GroupPath[]});

    expect(view.queryByText('No documents yet')).toBeNull();
    expect(header(view, 'essays')).toBeDefined();
  });

  it('should render a document row as its title and nothing else when it is at rest', function () {
    const view = panel();

    const opens = view.getByRole('button', {name: 'On writing'});

    expect(opens.closest('li')?.textContent).toBe('On writing');
    expect(opens.textContent).toBe('On writing');
  });

  it('should name a group header by its folder in normal case when it is rendered', function () {
    const view = panel();

    const drafts = header(view, 'drafts');

    expect(drafts.className).not.toContain('uppercase');
    expect(drafts.getAttribute('aria-expanded')).toBe('true');
  });

  it('should order a group’s documents by title when they arrive most recent first', function () {
    const view = panel({
      docs: [
        doc('drafts/c.md', 'C last', '2026-09-04T12:00:00.000Z'),
        doc('drafts/b.md', 'b middle', '2026-09-03T12:00:00.000Z'),
        doc('drafts/a.md', 'A draft first', '2026-09-02T12:00:00.000Z'),
      ],
      groups: ['drafts'] as GroupPath[],
    });

    const titles = Array.from(section(view, 'drafts').querySelectorAll('ul > li')).map(
      function (item) {
        return item.textContent;
      },
    );

    expect(titles).toEqual(['A draft first', 'b middle', 'C last']);
  });

  it('should keep every document in a group when the group’s own name matches the filter', function () {
    const {getByLabelText, getByText, queryByText} = panel();

    fireEvent.change(getByLabelText('Search documents'), {target: {value: 'drafts'}});

    expect(getByText('On writing')).toBeDefined();
    expect(getByText('Something else')).toBeDefined();
    expect(queryByText('A draft of nothing')).toBeNull();
  });

  it('should keep only the matching document when a group merely contains one', function () {
    const {getByLabelText, getByText, queryByText} = panel();

    fireEvent.change(getByLabelText('Search documents'), {target: {value: 'draft of'}});

    expect(getByText('A draft of nothing')).toBeDefined();
    expect(queryByText('On writing')).toBeNull();
    expect(queryByText('Something else')).toBeNull();
  });

  it('should hide a group’s documents and nothing else when it is collapsed', function () {
    const view = panel();

    fireEvent.click(header(view, 'drafts'));

    expect(view.queryByText('On writing')).toBeNull();
    expect(view.getByText('Root piece')).toBeDefined();
    expect(view.getByText('A draft of nothing')).toBeDefined();
  });

  it('should hide the ungrouped documents without touching the groups when that section is collapsed', function () {
    const view = panel();

    fireEvent.click(header(view, 'No group'));

    expect(view.queryByText('Root piece')).toBeNull();
    expect(view.getByText('On writing')).toBeDefined();
  });

  it('should reveal a match when it is inside a group the writer had folded shut', function () {
    const view = panel();
    fireEvent.click(header(view, 'drafts'));
    expect(view.queryByText('On writing')).toBeNull();

    fireEvent.change(view.getByLabelText('Search documents'), {target: {value: 'On writing'}});

    expect(view.getByText('On writing')).toBeDefined();
  });

  it('should fold the group shut again when the filter is cleared', function () {
    const view = panel();
    fireEvent.click(header(view, 'drafts'));
    fireEvent.change(view.getByLabelText('Search documents'), {target: {value: 'On writing'}});

    fireEvent.change(view.getByLabelText('Search documents'), {target: {value: ''}});

    expect(view.queryByText('On writing')).toBeNull();
  });

  it('should reveal a match among the ungrouped documents when they are folded shut', function () {
    const view = panel();
    fireEvent.click(header(view, 'No group'));
    expect(view.queryByText('Root piece')).toBeNull();

    fireEvent.change(view.getByLabelText('Search documents'), {target: {value: 'Root piece'}});

    expect(view.getByText('Root piece')).toBeDefined();
  });

  it('should open a document when its row is clicked', function () {
    const onOpen = mock(function () {});
    const {getByText} = panel({onOpen});

    fireEvent.click(getByText('On writing'));

    expect(onOpen).toHaveBeenCalledWith('drafts/one.md' as DocPath);
  });

  it('should say nothing matches rather than that the vault is empty when a filter finds nothing', function () {
    const {getByLabelText, getByText} = panel();

    fireEvent.change(getByLabelText('Search documents'), {target: {value: 'nothing here'}});

    expect(getByText('Nothing matches')).toBeDefined();
  });
});

describe('LibraryPanel menus', function () {
  it('should offer rename, move and delete when a document’s ⋯ is clicked', function () {
    const view = panel();

    fireEvent.click(more(view, 'On writing'));

    expect(view.getByRole('menu')).toBeDefined();
    expect(menuLabels(view)).toEqual(['Rename…', 'Move to…', 'Delete']);
  });

  it('should offer the same items when a document’s row is right-clicked', function () {
    const view = panel();

    fireEvent.contextMenu(view.getByRole('button', {name: 'On writing'}));

    expect(menuLabels(view)).toEqual(['Rename…', 'Move to…', 'Delete']);
  });

  it('should offer new document, rename and delete when a group’s ⋯ is clicked', function () {
    const view = panel();

    fireEvent.click(groupMore(view, 'drafts'));

    expect(menuLabels(view)).toEqual(['New document…', 'Rename…', 'Delete']);
  });

  it('should offer a new document and a new group when the header’s + is clicked', function () {
    const view = panel();

    fireEvent.click(view.getByRole('button', {name: 'New'}));

    expect(menuLabels(view)).toEqual(['New document…', 'New group…']);
  });

  it('should mark the ⋯ expanded when its menu is up', function () {
    const view = panel();

    fireEvent.click(more(view, 'On writing'));

    expect(more(view, 'On writing').getAttribute('aria-expanded')).toBe('true');
    expect(more(view, 'Something else').getAttribute('aria-expanded')).toBe('false');
  });

  it('should close the menu when its ⋯ is clicked a second time', function () {
    const view = panel();
    fireEvent.click(more(view, 'On writing'));

    fireEvent.click(more(view, 'On writing'));

    expect(view.queryByRole('menu')).toBeNull();
  });

  it('should move the caret to the next item when ArrowDown is pressed', function () {
    const view = panel();
    fireEvent.click(more(view, 'On writing'));
    const items = view.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0] as HTMLElement);

    fireEvent.keyDown(items[0] as HTMLElement, {key: 'ArrowDown'});

    expect(document.activeElement).toBe(items[1] as HTMLElement);
  });

  it('should wrap from the last item to the first when ArrowDown is pressed on the last', function () {
    const view = panel();
    fireEvent.click(more(view, 'On writing'));
    const items = view.getAllByRole('menuitem');
    fireEvent.keyDown(items[0] as HTMLElement, {key: 'End'});
    expect(document.activeElement).toBe(items[2] as HTMLElement);

    fireEvent.keyDown(items[2] as HTMLElement, {key: 'ArrowDown'});

    expect(document.activeElement).toBe(items[0] as HTMLElement);
  });

  it('should close the menu and hand the caret to its ⋯ when Escape is pressed', function () {
    const view = panel();
    fireEvent.click(more(view, 'On writing'));

    fireEvent.keyDown(document.activeElement as HTMLElement, {key: 'Escape'});

    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more(view, 'On writing'));
  });

  it('should start on the first item when another row is right-clicked with a menu up', function () {
    const view = panel();
    fireEvent.click(more(view, 'On writing'));
    fireEvent.keyDown(document.activeElement as HTMLElement, {key: 'End'});

    fireEvent.contextMenu(header(view, 'drafts'));

    const items = view.getAllByRole('menuitem');
    expect(menuLabels(view)).toEqual(['New document…', 'Rename…', 'Delete']);
    expect(document.activeElement).toBe(items[0] as HTMLElement);
    expect(items[0]?.getAttribute('tabindex')).toBe('0');
  });

  it('should close the menu when the writer clicks outside it', function () {
    const view = panel();
    fireEvent.click(more(view, 'On writing'));

    fireEvent.mouseDown(document.body);

    expect(view.queryByRole('menu')).toBeNull();
  });
});

describe('LibraryPanel edits', function () {
  it('should rename the file in its group when a document is renamed', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});

    pick(view, more(view, 'On writing'), 'Rename…');
    submitField(view, 'Title', 'Second thoughts');

    expect(onMoveDoc).toHaveBeenCalledWith(
      'drafts/one.md' as DocPath,
      'drafts/second-thoughts.md' as DocPath,
    );
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('should do nothing and close when a document’s title is submitted unchanged', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});
    pick(view, more(view, 'On writing'), 'Rename…');
    expect((view.getByLabelText('Title') as HTMLInputElement).value).toBe('On writing');

    fireEvent.submit(view.getByLabelText('Title'));

    expect(onMoveDoc).not.toHaveBeenCalled();
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('should rename a group under the same parent when its name is changed', function () {
    const onRenameGroup = mock(function () {});
    const view = panel({
      docs: [doc('drafts/2026/a.md', 'Buried')],
      groups: ['drafts', 'drafts/2026'] as GroupPath[],
      onRenameGroup,
    });

    pick(view, groupMore(view, '2026'), 'Rename…');
    expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('2026');
    submitField(view, 'Name', '2027');

    expect(onRenameGroup).toHaveBeenCalledWith(
      'drafts/2026' as GroupPath,
      'drafts/2027' as GroupPath,
    );
  });

  // A group past the indent limit is labelled with more than one segment, and
  // that label must not be mistaken for its name.
  it('should prefill a deep group’s own name and rename nothing when it is submitted unchanged', function () {
    const onRenameGroup = mock(function () {});
    const view = panel({
      docs: [],
      groups: ['a', 'a/b', 'a/b/c', 'a/b/c/d'] as GroupPath[],
      onRenameGroup,
    });

    pick(view, groupMore(view, 'c/d'), 'Rename…');
    expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('d');
    fireEvent.submit(view.getByLabelText('Name'));

    expect(onRenameGroup).not.toHaveBeenCalled();
  });

  it('should list the current group as unpickable when a document is being moved', function () {
    const view = panel();

    pick(view, more(view, 'On writing'), 'Move to…');
    const drafts = view.getByRole('option', {name: /drafts/});

    expect(drafts.getAttribute('aria-disabled')).toBe('true');
    expect(drafts.textContent).toContain('current');
  });

  it('should move the document into the picked group when the move is submitted', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});
    pick(view, more(view, 'On writing'), 'Move to…');

    fireEvent.click(view.getByRole('option', {name: 'essays'}));
    fireEvent.click(view.getByRole('button', {name: 'Move'}));

    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'essays/one.md' as DocPath);
  });

  it('should move the document to the vault root when No group is picked', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});
    pick(view, more(view, 'On writing'), 'Move to…');

    fireEvent.click(view.getByRole('option', {name: 'No group'}));
    fireEvent.click(view.getByRole('button', {name: 'Move'}));

    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'one.md' as DocPath);
  });

  it('should ignore a click on the current group when a document is being moved', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});
    pick(view, more(view, 'On writing'), 'Move to…');

    fireEvent.click(view.getByRole('option', {name: /drafts/}));
    fireEvent.click(view.getByRole('button', {name: 'Move'}));

    // Still on the first thing it could pick, which is the vault root.
    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'one.md' as DocPath);
  });

  it('should move to the group the filter narrowed to when Enter is pressed', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});
    pick(view, more(view, 'On writing'), 'Move to…');

    submitField(view, 'Filter groups', 'ess');

    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'essays/one.md' as DocPath);
  });

  it('should skip the current group when the arrow keys move the pick', function () {
    const onMoveDoc = mock(function () {});
    const view = panel({onMoveDoc});
    pick(view, more(view, 'On writing'), 'Move to…');
    const filter = view.getByLabelText('Filter groups');

    fireEvent.keyDown(filter, {key: 'ArrowDown'});
    fireEvent.submit(filter);

    expect(onMoveDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath, 'essays/one.md' as DocPath);
  });

  it('should create the picked kind inside the group when New document is raised from a group', function () {
    const onCreateDoc = mock(function () {});
    const view = panel({onCreateDoc});

    pick(view, groupMore(view, 'drafts'), 'New document…');
    fireEvent.change(view.getByLabelText('Kind'), {target: {value: 'proposal'}});
    submitField(view, 'Title', 'On Endings');

    expect(onCreateDoc).toHaveBeenCalledWith(
      'drafts/on-endings.md' as DocPath,
      'On Endings',
      'proposal',
    );
  });

  it('should create an article at the vault root when New document is raised from the header', function () {
    const onCreateDoc = mock(function () {});
    const view = panel({onCreateDoc});

    pick(view, view.getByRole('button', {name: 'New'}), 'New document…');
    submitField(view, 'Title', 'On Endings');

    expect(onCreateDoc).toHaveBeenCalledWith('on-endings.md' as DocPath, 'On Endings', 'article');
  });

  it('should offer every kind inkling writes in declared order when a document is being made', function () {
    const view = panel();

    pick(view, view.getByRole('button', {name: 'New'}), 'New document…');
    const options = Array.from(view.getByLabelText('Kind').querySelectorAll('option'));

    expect(
      options.map(function (option) {
        return option.textContent;
      }),
    ).toEqual(['article', 'email', 'proposal', 'note']);
  });

  it('should create nothing and close when a new document’s title is submitted empty', function () {
    const onCreateDoc = mock(function () {});
    const view = panel({onCreateDoc});
    pick(view, view.getByRole('button', {name: 'New'}), 'New document…');

    fireEvent.submit(view.getByLabelText('Title'));

    expect(onCreateDoc).not.toHaveBeenCalled();
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('should make a group from the path typed when New group is submitted', function () {
    const onCreateGroup = mock(function () {});
    const view = panel({onCreateGroup});

    pick(view, view.getByRole('button', {name: 'New'}), 'New group…');
    submitField(view, 'Name', 'essays/2026');

    expect(onCreateGroup).toHaveBeenCalledWith('essays/2026' as GroupPath);
  });

  it('should make nothing and close when New group is submitted empty', function () {
    const onCreateGroup = mock(function () {});
    const view = panel({onCreateGroup});
    pick(view, view.getByRole('button', {name: 'New'}), 'New group…');

    fireEvent.submit(view.getByLabelText('Name'));

    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('should raise the document’s delete without a modal when Delete is picked on it', function () {
    const onDeleteDoc = mock(function () {});
    const view = panel({onDeleteDoc});

    pick(view, more(view, 'On writing'), 'Delete');

    expect(onDeleteDoc).toHaveBeenCalledWith('drafts/one.md' as DocPath);
    expect(view.queryByRole('dialog')).toBeNull();
    expect(view.queryByRole('menu')).toBeNull();
  });

  it('should raise the group’s delete without a modal when Delete is picked on it', function () {
    const onDeleteGroup = mock(function () {});
    const view = panel({onDeleteGroup});

    pick(view, groupMore(view, 'drafts'), 'Delete');

    expect(onDeleteGroup).toHaveBeenCalledWith('drafts' as GroupPath);
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('should hand the caret back to the row’s ⋯ when a modal is cancelled with Escape', function () {
    const view = panel();
    pick(view, more(view, 'On writing'), 'Rename…');
    expect(document.activeElement).toBe(view.getByLabelText('Title'));

    fireEvent.keyDown(document.activeElement as HTMLElement, {key: 'Escape'});

    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more(view, 'On writing'));
  });

  it('should hand the caret back to the + when a modal raised from the header is cancelled', function () {
    const view = panel();
    pick(view, view.getByRole('button', {name: 'New'}), 'New group…');

    fireEvent.keyDown(document.activeElement as HTMLElement, {key: 'Escape'});

    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(view.getByRole('button', {name: 'New'}));
  });
});

describe('GroupRow paths', function () {
  it('should step each group’s contents in until the indent limit and then stop', function () {
    expect(nestsContents('a')).toBe(true);
    expect(nestsContents('a/b')).toBe(true);
    expect(nestsContents('a/b/c')).toBe(true);
    expect(nestsContents('a/b/c/d')).toBe(false);
  });

  it('should label a group with enough path to place it when it is past the last indent', function () {
    expect(labelOf('a/b/c')).toBe('c');
    expect(labelOf('a/b/c/d')).toBe('c/d');
    expect(labelOf('a/b/c/d/e')).toBe('c/d/e');
  });
});

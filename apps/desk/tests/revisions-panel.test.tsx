import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {fireEvent, render, waitFor} from '@testing-library/react';
import type {Revision, RevisionSummary} from '../src/lib/revisions.ts';
import {RevisionsPanel} from '../src/components/shell/RevisionsPanel.tsx';

autoCleanup();

/**
 * What a writer actually sees when they go looking for an earlier draft.
 * Queried off the render result rather than `screen`. See `setup.ts`.
 */

const DOC = 'drafts/a.md';

/** Minutes ago, so the relative labels are the same strings in every timezone. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

const OLDER: Revision = {
  id: 1,
  docPath: DOC,
  source: '# The first shape\n',
  createdAt: minutesAgo(180),
};

const NEWER: Revision = {
  id: 2,
  docPath: DOC,
  source: '---\ntitle: On endings\n---\n\n# The second shape\n',
  createdAt: minutesAgo(5),
};

function summary(revision: Revision): RevisionSummary {
  return {id: revision.id, docPath: revision.docPath, createdAt: revision.createdAt};
}

type PanelProps = {
  revisions?: readonly Revision[];
  onRestore?: (source: string) => void;
  onClose?: () => void;
};

function noop() {}

function panel({revisions = [NEWER, OLDER], onRestore = noop, onClose = noop}: PanelProps = {}) {
  const asked: number[] = [];

  /**
   * Every revision this panel has ever been handed, whichever document it
   * belongs to, so `onRead` keeps one identity across a rerender and still
   * resolves. An `onRead` rebuilt per render would re-run the read effect on its
   * own, which would clear the shown source for a reason the panel is not
   * responsible for and make the document-change cases pass without the panel
   * doing anything.
   */
  const known = new Map<number, Revision>();

  function onRead(id: number) {
    asked.push(id);
    return Promise.resolve(known.get(id));
  }

  function element(docPath: string, rows: readonly Revision[]) {
    rows.forEach(function (row) {
      known.set(row.id, row);
    });
    return (
      <RevisionsPanel
        revisions={rows.map(summary)}
        docPath={docPath}
        onRead={onRead}
        onRestore={onRestore}
        onClose={onClose}
      />
    );
  }

  const view = render(element(DOC, revisions));

  /** The writer opens another document while the panel is still up. */
  function showAnotherDoc(docPath: string, rows: readonly Revision[]) {
    view.rerender(element(docPath, rows));
  }

  return {view, asked, showAnotherDoc};
}

/** The revision buttons, in the order they are on screen. */
function items(view: ReturnType<typeof render>) {
  return view.getAllByRole('listitem').map(function (item) {
    return item.querySelector('button');
  });
}

/**
 * The revision text on screen, exactly as it is rendered.
 *
 * Read off the element rather than through `getByText`, which normalises
 * whitespace: a document's blank lines and its trailing newline are part of what
 * a restore puts back, so the assertion has to see them.
 */
function shownSource(view: ReturnType<typeof render>): string | undefined {
  return view.container.querySelector('pre')?.textContent ?? undefined;
}

describe('RevisionsPanel', function () {
  it('should list the revisions newest first', function () {
    const {view} = panel();

    const rendered = items(view);

    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.textContent).toContain('5m');
    expect(rendered[1]?.textContent).toContain('3h');
  });

  it('should read the revision the writer picked', async function () {
    const {view, asked} = panel();

    fireEvent.click(items(view)[0] as HTMLButtonElement);

    await waitFor(function () {
      expect(asked).toEqual([NEWER.id]);
    });
  });

  it('should show a picked revision source, frontmatter and all', async function () {
    const {view} = panel();

    fireEvent.click(items(view)[0] as HTMLButtonElement);

    await waitFor(function () {
      expect(shownSource(view)).toBe(NEWER.source);
    });
  });

  it('should hand the restore the source of the revision on screen', async function () {
    const restored: string[] = [];
    const {view} = panel({
      onRestore(source) {
        restored.push(source);
      },
    });
    fireEvent.click(items(view)[1] as HTMLButtonElement);
    await waitFor(function () {
      expect(shownSource(view)).toBe(OLDER.source);
    });

    fireEvent.click(view.getByText('Restore'));

    expect(restored).toEqual([OLDER.source]);
  });

  // Nothing to put back until one is on screen, so the control refuses rather
  // than restoring whichever revision happened to be listed first.
  it('should refuse to restore before a revision is picked', function () {
    const restored: string[] = [];
    const {view} = panel({
      onRestore(source) {
        restored.push(source);
      },
    });

    fireEvent.click(view.getByText('Restore'));

    expect(restored).toEqual([]);
  });

  // The panel outlives a document change. Leaving the old document's prose on
  // screen under the new one's name would put a Restore one click away from
  // writing one document's text into a different file.
  it('should drop the revision on screen when another document is opened', async function () {
    const {view, showAnotherDoc} = panel();
    fireEvent.click(items(view)[0] as HTMLButtonElement);
    await waitFor(function () {
      expect(shownSource(view)).toBe(NEWER.source);
    });

    showAnotherDoc('drafts/b.md', []);

    expect(shownSource(view)).toBeUndefined();
    expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Revisions of drafts/b.md');
  });

  it('should refuse to restore a revision left over from another document', async function () {
    const restored: string[] = [];
    const {view, showAnotherDoc} = panel({
      onRestore(source) {
        restored.push(source);
      },
    });
    fireEvent.click(items(view)[0] as HTMLButtonElement);
    await waitFor(function () {
      expect(shownSource(view)).toBe(NEWER.source);
    });

    showAnotherDoc('drafts/b.md', []);
    fireEvent.click(view.getByText('Restore'));

    expect(restored).toEqual([]);
  });

  /** A button standing in for whatever had the caret before the panel opened. */
  function elsewhere() {
    const button = document.createElement('button');
    document.body.append(button);
    return button;
  }

  // `aria-modal` says the rest of the window is out of play, so the caret has to
  // be in here, and has to go back where it was when the panel closes.
  it('should take the focus while it is up and hand it back when it goes', function () {
    const opener = elsewhere();
    opener.focus();

    const {view} = panel();
    expect(document.activeElement).toBe(view.getByRole('dialog'));

    view.unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // Closing by clicking somewhere else means the writer has already said where
  // they want to be. Pulling the caret back to the menu would undo that.
  it('should leave the focus alone when something else already took it', function () {
    const opener = elsewhere();
    opener.focus();
    const {view} = panel();
    const clicked = elsewhere();

    clicked.focus();
    view.unmount();

    expect(document.activeElement).toBe(clicked);
    opener.remove();
    clicked.remove();
  });

  /**
   * One control the caret can reach inside the dialog, counted from the front or,
   * with a negative index, from the back. Throws rather than returning undefined,
   * so a dialog that stopped rendering its controls fails here by name.
   */
  function stop(view: ReturnType<typeof render>, index: number): HTMLElement {
    const controls = Array.from(
      view.getByRole('dialog').querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    const found = controls[index < 0 ? controls.length + index : index];
    if (found === undefined) throw new Error(`the dialog has no reachable control at ${index}`);
    return found;
  }

  // The three panels behind this are still in the tab order, so without the wrap
  // the caret walks out of a dialog that told a screen reader it was modal.
  it('should send Tab from the last control back to the first', function () {
    const {view} = panel();
    stop(view, -1).focus();

    fireEvent.keyDown(document, {key: 'Tab'});

    expect(document.activeElement).toBe(stop(view, 0));
  });

  it('should send Shift+Tab from the first control back to the last', function () {
    const {view} = panel();
    stop(view, 0).focus();

    fireEvent.keyDown(document, {key: 'Tab', shiftKey: true});

    expect(document.activeElement).toBe(stop(view, -1));
  });

  // The caret starts on the dialog itself, which is not a stop, so the first Tab
  // has to enter the list rather than wrap past it.
  it('should send the first Tab into the dialog rather than out of it', function () {
    const {view} = panel();

    fireEvent.keyDown(document, {key: 'Tab'});

    expect(document.activeElement).toBe(stop(view, 0));
  });

  // A Tab in the middle of the list is the browser's to handle, and jsdom does
  // not move focus for it. A trap that wrapped here rather than only at the edge
  // would pull the caret back to the top of the list on every Tab.
  it('should leave a Tab between two controls to the browser', function () {
    const {view} = panel();
    const middle = stop(view, 1);
    middle.focus();

    fireEvent.keyDown(document, {key: 'Tab'});

    expect(document.activeElement).toBe(middle);
  });

  it('should say so rather than show an empty box when there are no revisions', function () {
    const {view} = panel({revisions: []});

    expect(view.getByText('No revisions of this document yet.')).toBeDefined();
    expect(view.queryAllByRole('listitem')).toEqual([]);
  });

  it('should close on Escape', function () {
    let closed = 0;
    panel({
      onClose() {
        closed += 1;
      },
    });

    fireEvent.keyDown(document, {key: 'Escape'});

    expect(closed).toBe(1);
  });

  it('should close on a click outside it', function () {
    let closed = 0;
    panel({
      onClose() {
        closed += 1;
      },
    });

    fireEvent.mouseDown(document.body);

    expect(closed).toBe(1);
  });

  // A stored timestamp this cannot parse is still the only thing telling two
  // revisions apart, so it is shown as it is rather than as "Invalid Date".
  it('should show a timestamp it cannot parse rather than the words Invalid Date', function () {
    const {view} = panel({revisions: [{...NEWER, createdAt: 'sometime'}]});

    expect(items(view)[0]?.textContent).toContain('sometime');
    expect(items(view)[0]?.textContent).not.toContain('Invalid Date');
  });
});

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
  const view = render(
    <RevisionsPanel
      revisions={revisions.map(summary)}
      docPath={DOC}
      onRead={function (id: number) {
        asked.push(id);
        return Promise.resolve(
          revisions.find(function (entry) {
            return entry.id === id;
          }),
        );
      }}
      onRestore={onRestore}
      onClose={onClose}
    />,
  );
  return {view, asked};
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

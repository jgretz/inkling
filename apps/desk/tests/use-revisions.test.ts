import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {DocPath} from '@inkling/vault';
import type {Revision, RevisionStore, RevisionSummary} from '../src/lib/revisions.ts';
import {useRevisions} from '../src/lib/use-revisions.ts';

autoCleanup();

const DOC = 'drafts/a.md' as DocPath;
const OTHER = 'drafts/b.md' as DocPath;

/** A store over an in-memory vault, recording what a caller asked it to do. */
function vault(rows: Revision[] = []) {
  const listed: string[] = [];
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;

  function summary(row: Revision): RevisionSummary {
    return {id: row.id, docPath: row.docPath, createdAt: row.createdAt};
  }

  const store: RevisionStore = {
    list(docPath) {
      listed.push(docPath);
      return Promise.resolve(
        rows
          .filter(function (row) {
            return row.docPath === docPath;
          })
          .map(summary)
          .reverse(),
      );
    },
    create(docPath, source) {
      const kept: Revision = {
        id: nextId++,
        docPath,
        source,
        createdAt: `2026-01-0${nextId}T00:00:00.000Z`,
      };
      rows.push(kept);
      return Promise.resolve(summary(kept));
    },
    read(id) {
      const row = rows.find(function (entry) {
        return entry.id === id;
      });
      if (row === undefined) return Promise.reject(new Error(`no revision ${id} to read`));
      return Promise.resolve(row);
    },
  };

  return {store, rows, listed};
}

function revision(overrides: Partial<Revision> = {}): Revision {
  return {
    id: 1,
    docPath: DOC,
    source: '# On endings\n',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * `docPath` is passed explicitly rather than defaulted: a default would swallow
 * the `undefined` the "no document open" case is entirely about.
 */
function mount(store: RevisionStore, docPath: DocPath | undefined, ready = true) {
  return renderHook(
    function (props: {docPath: DocPath | undefined}) {
      return useRevisions({store, docPath: props.docPath, ready});
    },
    {initialProps: {docPath}},
  );
}

describe('useRevisions', function () {
  it('should list the open document revisions newest first', async function () {
    const {store} = vault([revision(), revision({id: 2, source: '# Later\n'})]);

    const {result} = mount(store, DOC);

    await waitFor(function () {
      expect(result.current.all).toHaveLength(2);
    });
    expect(result.current.all[0]?.id).toBe(2);
  });

  it('should keep the source it was handed as the next revision', async function () {
    const {store, rows} = vault();
    const {result} = mount(store, DOC);

    await act(async function () {
      await result.current.snapshot('# A draft worth keeping\n');
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('# A draft worth keeping\n');
    expect(result.current.all).toHaveLength(1);
  });

  /**
   * The claim the whole feature rests on: what comes back out is byte for byte
   * what went in, so a snapshot taken and immediately restored changes nothing.
   */
  it('should hand a restore the exact source that was snapshotted', async function () {
    const source = '---\ntitle: On endings\n---\n\n# On endings\n\nThe body.\n';
    const {store} = vault();
    const {result} = mount(store, DOC);
    const restored: string[] = [];

    await act(async function () {
      const kept = await result.current.snapshot(source);
      const read = await result.current.read(kept?.id ?? -1);
      if (read !== undefined) restored.push(read.source);
    });

    expect(restored).toEqual([source]);
  });

  it('should empty the list when another document is opened', async function () {
    const {store} = vault([revision()]);
    const {result, rerender} = mount(store, DOC);
    await waitFor(function () {
      expect(result.current.all).toHaveLength(1);
    });

    rerender({docPath: OTHER});

    await waitFor(function () {
      expect(result.current.all).toEqual([]);
    });
  });

  it('should read nothing and write nothing while the vault database is not open', async function () {
    const {store, rows, listed} = vault([revision()]);

    const {result} = mount(store, DOC, false);
    await act(async function () {
      await result.current.snapshot('# Not kept\n');
    });

    expect(result.current.all).toEqual([]);
    expect(listed).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('should do nothing at all with no document open', async function () {
    const {store, rows, listed} = vault();

    const {result} = mount(store, undefined);
    await act(async function () {
      const kept = await result.current.snapshot('# Not kept\n');
      expect(kept).toBeUndefined();
    });

    expect(listed).toEqual([]);
    expect(rows).toEqual([]);
  });

  // The panel says so on screen; the caller cannot tell a revision that failed
  // to read from one whose text is genuinely empty unless this says which.
  it('should resolve to undefined when a revision cannot be read', async function () {
    const {store} = vault([revision()]);
    const {result} = mount(store, DOC);

    let read: Revision | undefined = revision();
    await act(async function () {
      read = await result.current.read(404);
    });

    expect(read).toBeUndefined();
  });

  it('should reject a snapshot the database refused, saying so', async function () {
    const {store} = vault();
    store.create = function () {
      return Promise.reject(new Error('database is locked'));
    };
    const {result} = mount(store, DOC);

    let said = '';
    await act(async function () {
      await result.current.snapshot('# Draft\n').catch(function (error: unknown) {
        said = error instanceof Error ? error.message : String(error);
      });
    });

    expect(said).toContain('could not save a revision');
    expect(said).toContain('database is locked');
  });
});

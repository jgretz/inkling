import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {DocPath, VaultPath} from '@inkling/vault';
import type {
  ContextReference,
  ReferenceStore,
  StoredReference,
  StoredReferenceSuppression,
} from '../src/lib/references.ts';
import {useReferences} from '../src/lib/use-references.ts';

autoCleanup();

/**
 * The vault's references, driven through an in-memory store.
 *
 * The store is a value the hook takes rather than a module it imports, so the
 * database is two arrays here and nothing needs a webview. Never a module mock
 * of `bridge.ts` instead: bun's mock registry is global to a run and would
 * reach every other file that imports it.
 */

const VAULT = '/Users/writer/vault' as VaultPath;
const NESTED = 'drafts/2026/piece.md' as DocPath;
const ROOT = 'a.md' as DocPath;
/** Module scope, so its identity never moves: a fresh list re-runs the load. */
const TAKEN: readonly DocPath[] = ['references/brief.md' as DocPath];
const NOTHING_TAKEN: readonly DocPath[] = [];

type Member = keyof ReferenceStore;

/**
 * A store over an in-memory database, logging every call it takes in order.
 *
 * `add` is idempotent on owner, kind and target, the way `add_reference`
 * resolves to the stored row whether this call created it or an earlier one
 * did. A member named in `fail` rejects instead.
 */
function vault(
  rows: StoredReference[] = [],
  suppressions: StoredReferenceSuppression[] = [],
  fail: ReadonlySet<Member> = new Set(),
) {
  const calls: string[] = [];
  let nextId = Math.max(0, ...rows.map((row) => row.id), ...suppressions.map((row) => row.id)) + 1;

  function refused(member: Member): Promise<never> | undefined {
    return fail.has(member) ? Promise.reject(new Error(`${member} refused`)) : undefined;
  }

  function stored(fields: Omit<StoredReference, 'id' | 'createdAt'>): StoredReference {
    const same = rows.find(function (row) {
      return (
        row.docPath === fields.docPath &&
        row.groupPath === fields.groupPath &&
        row.kind === fields.kind &&
        row.targetPath === fields.targetPath &&
        row.url === fields.url
      );
    });
    if (same !== undefined) return same;
    const row = {...fields, id: nextId++, createdAt: '2026-01-01T00:00:00.000Z'};
    rows.push(row);
    return row;
  }

  const store: ReferenceStore = {
    list() {
      calls.push('list');
      return refused('list') ?? Promise.resolve([...rows]);
    },
    listSuppressions() {
      calls.push('listSuppressions');
      return refused('listSuppressions') ?? Promise.resolve([...suppressions]);
    },
    add(reference) {
      calls.push(`add ${reference.kind} ${reference.targetPath ?? reference.url}`);
      return (
        refused('add') ??
        Promise.resolve(
          stored({
            docPath: reference.owner.kind === 'doc' ? reference.owner.path : null,
            groupPath: reference.owner.kind === 'group' ? reference.owner.path : null,
            kind: reference.kind,
            targetPath: reference.targetPath ?? null,
            url: reference.url ?? null,
            title: reference.title,
          }),
        )
      );
    },
    addLinks(owner, links) {
      calls.push(`addLinks ${links.length}`);
      const refusal = refused('addLinks');
      if (refusal !== undefined) return refusal;
      const before = new Set(rows.map((row) => row.id));
      const landed = links.map(function (link) {
        return stored({
          docPath: owner.kind === 'doc' ? owner.path : null,
          groupPath: owner.kind === 'group' ? owner.path : null,
          kind: 'link',
          targetPath: null,
          url: link.url,
          title: link.title,
        });
      });
      return Promise.resolve({
        attached: landed.filter((row) => !before.has(row.id)),
        skipped: landed.filter((row) => before.has(row.id)),
      });
    },
    remove(id) {
      calls.push(`remove ${id}`);
      return refused('remove') ?? Promise.resolve();
    },
    suppress(docPath, referenceId) {
      calls.push(`suppress ${docPath} ${referenceId}`);
      const refusal = refused('suppress');
      if (refusal !== undefined) return refusal;
      const row = {id: nextId++, docPath, referenceId, createdAt: '2026-01-01T00:00:00.000Z'};
      suppressions.push(row);
      return Promise.resolve(row);
    },
    restore(id) {
      calls.push(`restore ${id}`);
      return refused('restore') ?? Promise.resolve();
    },
    createDoc(_vault, path) {
      calls.push(`createDoc ${path}`);
      return refused('createDoc') ?? Promise.resolve();
    },
  };

  return {store, rows, suppressions, calls};
}

function row(overrides: Partial<StoredReference> = {}): StoredReference {
  return {
    id: 1,
    docPath: NESTED,
    groupPath: null,
    kind: 'link',
    targetPath: null,
    url: 'https://example.com/one',
    title: 'One',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The three fields of a strip entry the hook reads: `id`, `title`, `suppressedBy`. */
function entry(id: number, suppressedBy?: number): ContextReference {
  return {
    id,
    kind: 'link',
    title: `reference ${id}`,
    source: '',
    target: 'https://example.com',
    origin: {level: 'document'},
    missing: false,
    suppressedBy,
    tokens: 0,
  };
}

type MountOptions = {
  vault?: VaultPath | undefined;
  ready?: boolean;
  taken?: readonly DocPath[];
  calls?: string[];
};

/** `onNoteWritten` logs `rescan` onto the store's own log, so ordering is one list. */
function mount(store: ReferenceStore, docPath: DocPath | undefined, options: MountOptions = {}) {
  const calls = options.calls ?? [];
  const chosen = 'vault' in options ? options.vault : VAULT;
  const ready = options.ready ?? true;
  const taken = options.taken ?? NOTHING_TAKEN;
  function onNoteWritten() {
    calls.push('rescan');
  }
  return renderHook(function () {
    return useReferences({store, vault: chosen, docPath, ready, taken, onNoteWritten});
  });
}

/** Mounted and loaded, with the load's two reads cleared off the log. */
async function loaded(
  state: ReturnType<typeof vault>,
  docPath: DocPath | undefined,
  options: MountOptions = {},
) {
  const view = mount(state.store, docPath, {...options, calls: state.calls});
  await waitFor(function () {
    expect(state.calls).toContain('listSuppressions');
  });
  await act(async function () {});
  state.calls.length = 0;
  return view;
}

function ids(rows: readonly {id: number}[]): number[] {
  return rows
    .map(function (entry) {
      return entry.id;
    })
    .sort(function (a, b) {
      return a - b;
    });
}

describe('loading', function () {
  it('should hold the stored rows and suppressions once the vault is ready', async function () {
    const off = {id: 9, docPath: NESTED, referenceId: 1, createdAt: '2026-01-01T00:00:00.000Z'};
    const state = vault([row()], [off]);

    const {result} = mount(state.store, NESTED, {calls: state.calls});

    await waitFor(function () {
      expect(result.current.rows).toEqual([row()]);
    });
    expect(result.current.suppressions).toEqual([off]);
  });

  it('should hold nothing and read nothing when no vault is chosen', async function () {
    const state = vault([row()]);

    const {result} = mount(state.store, NESTED, {vault: undefined, calls: state.calls});
    await act(async function () {});

    expect(state.calls).toEqual([]);
    expect(result.current.rows).toEqual([]);
  });

  it('should hold nothing and read nothing when the database is not ready', async function () {
    const state = vault([row()]);

    const {result} = mount(state.store, NESTED, {ready: false, calls: state.calls});
    await act(async function () {});

    expect(state.calls).toEqual([]);
    expect(result.current.rows).toEqual([]);
  });
});

describe('attach', function () {
  it('should write a note body, then rescan, then add the row when a note is attached', async function () {
    const state = vault();
    const {result} = await loaded(state, NESTED);

    await act(async function () {
      result.current.attach({level: 'document', kind: 'note', title: 'Brief'});
    });

    expect(state.calls).toEqual([
      'createDoc references/brief.md',
      'rescan',
      'add note references/brief.md',
    ]);
    expect(result.current.rows.map((entry) => entry.targetPath)).toEqual(['references/brief.md']);
  });

  it('should add no row and not rescan when the note body could not be written', async function () {
    const state = vault([row()], [], new Set<Member>(['createDoc']));
    const {result} = await loaded(state, NESTED);

    await act(async function () {
      result.current.attach({level: 'document', kind: 'note', title: 'Brief'});
    });

    expect(state.calls).toEqual(['createDoc references/brief.md']);
    expect(result.current.rows).toEqual([row()]);
  });

  it('should give a note a path no document already has when its slug is taken', async function () {
    const state = vault();
    const {result} = await loaded(state, NESTED, {taken: TAKEN});

    await act(async function () {
      result.current.attach({level: 'document', kind: 'note', title: 'Brief'});
    });

    expect(state.calls[0]).toBe('createDoc references/brief-2.md');
  });

  it('should make no call at all when a root document attaches at group level', async function () {
    const state = vault();
    const {result} = await loaded(state, ROOT);

    await act(async function () {
      result.current.attach({level: 'group', kind: 'note', title: 'Brief'});
      result.current.attach({level: 'group', kind: 'link', title: 'One', url: 'https://a.test'});
    });

    expect(state.calls).toEqual([]);
    expect(result.current.rows).toEqual([]);
  });

  it('should hand the store the owner the level names', async function () {
    const state = vault();
    const {result} = await loaded(state, NESTED);

    await act(async function () {
      result.current.attach({level: 'group', kind: 'link', title: 'G', url: 'https://g.test'});
      result.current.attach({level: 'document', kind: 'link', title: 'D', url: 'https://d.test'});
    });

    const byUrl = new Map(state.rows.map((stored) => [stored.url, stored]));
    expect(byUrl.get('https://g.test')).toMatchObject({groupPath: 'drafts/2026', docPath: null});
    expect(byUrl.get('https://d.test')).toMatchObject({groupPath: null, docPath: NESTED});
  });

  it('should hold one row, not two, when a target already attached is attached again', async function () {
    const existing = row({url: 'https://a.test'});
    const state = vault([existing]);
    const {result} = await loaded(state, NESTED);

    await act(async function () {
      result.current.attach({level: 'document', kind: 'link', title: 'A', url: 'https://a.test'});
    });

    expect(state.calls).toEqual(['add link https://a.test']);
    expect(result.current.rows).toEqual([existing]);
  });
});

describe('attachMany', function () {
  const links = [{url: 'https://a.test', title: 'A', derived: false}];

  it('should refuse a group-level paste on a root document and never call the store', async function () {
    const state = vault();
    const {result} = await loaded(state, ROOT);

    const pasted = result.current.attachMany({level: 'group', links, ignoredLines: 0});

    await expect(pasted).rejects.toThrow('this document is not in a group');
    expect(state.calls).toEqual([]);
  });

  it('should refuse a paste when the database is not ready', async function () {
    const state = vault();
    const {result} = mount(state.store, NESTED, {ready: false, calls: state.calls});

    const pasted = result.current.attachMany({level: 'document', links, ignoredLines: 0});

    await expect(pasted).rejects.toThrow('there is nowhere to attach these links yet');
    expect(state.calls).toEqual([]);
  });

  // Three kinds of link in one paste: one new, one the rows already hold, and
  // one the database holds that this hook never loaded. The last is what folding
  // `skipped` is for: without it that row stays off the strip until a rescan.
  it('should fold both attached and skipped rows in, each exactly once', async function () {
    const known = row({id: 1, url: 'https://known.test'});
    const state = vault([known]);
    const {result} = await loaded(state, NESTED);
    // Past any id the store will assign, so the fresh link cannot collide with it.
    const unseen = row({id: 10, url: 'https://unseen.test'});
    state.rows.push(unseen);

    let landed = {attached: 0, skipped: 0};
    await act(async function () {
      landed = await result.current.attachMany({
        level: 'document',
        links: [
          {url: 'https://fresh.test', title: 'Fresh', derived: false},
          {url: 'https://known.test', title: 'Known', derived: false},
          {url: 'https://unseen.test', title: 'Unseen', derived: false},
        ],
        ignoredLines: 0,
      });
    });

    expect(landed).toEqual({attached: 1, skipped: 2});
    expect(ids(result.current.rows)).toEqual([1, 2, 10]);
  });
});

describe('detach, suppress and restore', function () {
  it('should drop the row and every suppression filed against it when detached', async function () {
    const kept = row({id: 2, url: 'https://kept.test'});
    const state = vault(
      [row({id: 1}), kept],
      [
        {id: 7, docPath: NESTED, referenceId: 1, createdAt: '2026-01-01T00:00:00.000Z'},
        {
          id: 8,
          docPath: 'drafts/2026/other.md',
          referenceId: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {id: 9, docPath: NESTED, referenceId: 2, createdAt: '2026-01-01T00:00:00.000Z'},
      ],
    );
    const {result} = await loaded(state, NESTED);

    await act(async function () {
      result.current.detach(entry(1));
    });

    expect(state.calls).toEqual(['remove 1']);
    expect(result.current.rows).toEqual([kept]);
    expect(ids(result.current.suppressions)).toEqual([9]);
  });

  it('should file a suppression for the open document and remove it on restore', async function () {
    const state = vault([row({id: 1, docPath: null, groupPath: 'drafts'})]);
    const {result} = await loaded(state, NESTED);

    await act(async function () {
      result.current.suppress(entry(1));
    });

    expect(state.calls).toEqual([`suppress ${NESTED} 1`]);
    expect(result.current.suppressions).toHaveLength(1);
    const filed = result.current.suppressions[0];
    expect(filed).toMatchObject({docPath: NESTED, referenceId: 1});

    await act(async function () {
      result.current.restore(entry(1, filed?.id));
    });

    expect(state.calls).toEqual([`suppress ${NESTED} 1`, `restore ${filed?.id}`]);
    expect(result.current.suppressions).toEqual([]);
  });
});

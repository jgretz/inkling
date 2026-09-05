import {describe, expect, it} from 'bun:test';
import type {DocPath, GroupPath} from '@inkling/vault';
import {
  assembleReferences,
  notePathFor,
  NOTE_DIR,
  type StoredReference,
  type StoredReferenceSuppression,
} from '../src/lib/references.ts';

/** A row as `list_references` returns it, with only the columns each kind uses. */
function docRow(
  id: number,
  owner: {doc?: string; group?: string},
  target: string,
): StoredReference {
  return {
    id,
    docPath: owner.doc ?? null,
    groupPath: owner.group ?? null,
    kind: 'doc',
    targetPath: target,
    url: null,
    title: target,
    createdAt: '2026-09-04T12:00:00.000Z',
  };
}

function linkRow(id: number, owner: {doc?: string; group?: string}, url: string): StoredReference {
  return {
    id,
    docPath: owner.doc ?? null,
    groupPath: owner.group ?? null,
    kind: 'link',
    targetPath: null,
    url,
    title: 'The style guide',
    createdAt: '2026-09-04T12:00:00.000Z',
  };
}

function turnedOff(id: number, docPath: string, referenceId: number): StoredReferenceSuppression {
  return {id, docPath, referenceId, createdAt: '2026-09-04T12:00:00.000Z'};
}

function sources(entries: Record<string, string>): ReadonlyMap<DocPath, string> {
  return new Map(Object.entries(entries) as Array<[DocPath, string]>);
}

const PIECE = 'drafts/2026/piece.md' as DocPath;

const LOADED = sources({
  'drafts/2026/piece.md': '# The piece\n',
  'notes/style.md': 'x'.repeat(40),
  'notes/tone.md': 'y'.repeat(80),
});

describe('assembleReferences', function () {
  it('should return nothing when no document is open', function () {
    expect(
      assembleReferences(undefined, [docRow(1, {group: 'drafts'}, 'notes/style.md')], LOADED),
    ).toEqual([]);
  });

  /** Roadmap 3.1's own done-criterion: a group's reference reaches the document. */
  it('should reach a nested document from a reference attached to a group above it', function () {
    const assembled = assembleReferences(
      PIECE,
      [docRow(1, {group: 'drafts'}, 'notes/style.md')],
      LOADED,
    );

    expect(assembled).toHaveLength(1);
    expect(assembled[0]?.origin).toEqual({level: 'group', group: 'drafts' as GroupPath});
    expect(assembled[0]?.source).toBe('x'.repeat(40));
    expect(assembled[0]?.tokens).toBe(10);
  });

  it('should not reach a document outside the group that owns the reference', function () {
    const assembled = assembleReferences(
      'essays/other.md' as DocPath,
      [docRow(1, {group: 'drafts'}, 'notes/style.md')],
      LOADED,
    );

    expect(assembled).toEqual([]);
  });

  it('should order the cascade root-most group first and the document last', function () {
    const assembled = assembleReferences(
      PIECE,
      [
        docRow(3, {doc: 'drafts/2026/piece.md'}, 'notes/tone.md'),
        docRow(2, {group: 'drafts/2026'}, 'notes/style.md'),
        docRow(1, {group: 'drafts'}, 'notes/style.md'),
      ],
      LOADED,
    );

    const levels = assembled.map(function (entry): string {
      return entry.origin.level === 'group' ? entry.origin.group : 'document';
    });

    expect(levels).toEqual(['drafts', 'drafts/2026', 'document']);
  });

  it('should order two references at one level by the order they were attached', function () {
    const assembled = assembleReferences(
      PIECE,
      [
        docRow(9, {group: 'drafts'}, 'notes/tone.md'),
        docRow(4, {group: 'drafts'}, 'notes/style.md'),
      ],
      LOADED,
    );

    expect(
      assembled.map(function (entry) {
        return entry.id;
      }),
    ).toEqual([4, 9]);
  });

  it('should give a document at the vault root its own references and nothing above', function () {
    const assembled = assembleReferences(
      'a.md' as DocPath,
      [docRow(1, {doc: 'a.md'}, 'notes/style.md'), docRow(2, {group: 'drafts'}, 'notes/tone.md')],
      LOADED,
    );

    expect(assembled).toHaveLength(1);
    expect(assembled[0]?.origin).toEqual({level: 'document'});
  });

  it('should carry a link as its address, costing nothing and never missing', function () {
    const assembled = assembleReferences(
      PIECE,
      [linkRow(1, {doc: 'drafts/2026/piece.md'}, 'https://example.com')],
      LOADED,
    );

    expect(assembled[0]?.target).toBe('https://example.com');
    expect(assembled[0]?.missing).toBe(false);
    expect(assembled[0]?.tokens).toBe(0);
  });

  /**
   * The row is kept and shown as broken rather than dropped: a writer who moved
   * a file outside inkling gets the attachment back when they move it again,
   * and a silently vanished reference is the worse surprise.
   */
  it('should mark a reference whose file the vault no longer holds', function () {
    const assembled = assembleReferences(
      PIECE,
      [docRow(1, {doc: 'drafts/2026/piece.md'}, 'notes/gone.md')],
      LOADED,
    );

    expect(assembled).toHaveLength(1);
    expect(assembled[0]?.missing).toBe(true);
    expect(assembled[0]?.source).toBe('');
    expect(assembled[0]?.tokens).toBe(0);
  });

  it('should turn an inherited reference off for the document that suppressed it', function () {
    const rows = [docRow(1, {group: 'drafts'}, 'notes/style.md')];

    const assembled = assembleReferences(PIECE, rows, LOADED, [turnedOff(7, PIECE, 1)]);

    expect(assembled[0]?.suppressedBy).toBe(7);
    expect(assembled[0]?.source).toBe('');
    expect(assembled[0]?.tokens).toBe(0);
  });

  it('should leave the same inherited reference on for another document', function () {
    const rows = [docRow(1, {group: 'drafts'}, 'notes/style.md')];

    const assembled = assembleReferences(PIECE, rows, LOADED, [
      turnedOff(7, 'drafts/2026/other.md', 1),
    ]);

    expect(assembled[0]?.suppressedBy).toBeUndefined();
    expect(assembled[0]?.tokens).toBe(10);
  });

  /** Detaching is what removes your own; a suppression of it means nothing. */
  it('should ignore a suppression filed against the documents own reference', function () {
    const rows = [docRow(1, {doc: 'drafts/2026/piece.md'}, 'notes/style.md')];

    const assembled = assembleReferences(PIECE, rows, LOADED, [turnedOff(7, PIECE, 1)]);

    expect(assembled[0]?.suppressedBy).toBeUndefined();
    expect(assembled[0]?.tokens).toBe(10);
  });

  it('should return the same result when called twice with the same inputs', function () {
    const rows = [
      docRow(1, {group: 'drafts'}, 'notes/style.md'),
      linkRow(2, {group: 'drafts/2026'}, 'https://example.com'),
      docRow(3, {doc: 'drafts/2026/piece.md'}, 'notes/gone.md'),
    ];

    const first = assembleReferences(PIECE, rows, LOADED, [turnedOff(7, PIECE, 1)]);
    const second = assembleReferences(PIECE, rows, LOADED, [turnedOff(7, PIECE, 1)]);

    expect(first).toEqual(second);
  });
});

describe('notePathFor', function () {
  it('should slug a title into the references folder', function () {
    expect(notePathFor('On Endings, at last', new Set())).toBe(
      `${NOTE_DIR}/on-endings-at-last.md` as DocPath,
    );
  });

  it('should fall back to a name the writer can rename when nothing survives the slug', function () {
    expect(notePathFor('!!!', new Set())).toBe(`${NOTE_DIR}/note.md` as DocPath);
  });

  it('should number a second note whose title slugs the same way', function () {
    const taken = new Set([`${NOTE_DIR}/tone.md`]);

    expect(notePathFor('Tone', taken)).toBe(`${NOTE_DIR}/tone-2.md` as DocPath);
  });

  it('should keep counting past a number that is already taken', function () {
    const taken = new Set([`${NOTE_DIR}/tone.md`, `${NOTE_DIR}/tone-2.md`]);

    expect(notePathFor('Tone', taken)).toBe(`${NOTE_DIR}/tone-3.md` as DocPath);
  });
});

/**
 * The assembler runs wherever the rows do: in a test with no DOM, and one day
 * in whatever assembles a prompt. Naming `bridge.ts` or `@tauri-apps` would end
 * that, and neither shows up as a type error, so it is scanned rather than
 * assumed. Modelled on `packages/voice/tests/package-purity.test.ts`.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:\\])\/\/[^\n]*/g;

const STATIC_IMPORT = /\b(?:import|export)\b[^'"]*?\bfrom\s*'([^'\n]+)'/g;
const DYNAMIC_IMPORT = /\bimport\s*\(?\s*'([^'\n]+)'/g;

/** Comments carry prose about files and boundaries; code is what is scanned. */
async function code(): Promise<string> {
  const source = await Bun.file(
    Bun.fileURLToPath(new URL('../src/lib/references.ts', import.meta.url)),
  ).text();
  return source.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '$1');
}

/** Host capabilities a pure function cannot reach for. */
const HOST_GLOBALS: ReadonlyArray<{name: string; pattern: RegExp}> = [
  {name: 'window', pattern: /\bwindow\s*[.[]/},
  {name: 'document', pattern: /\bdocument\s*[.[]/},
  {name: 'localStorage', pattern: /\blocalStorage\b/},
  {name: 'fetch', pattern: /\bfetch\s*\(/},
  {name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/},
  {name: 'process', pattern: /\bprocess\s*[.[]/},
  {name: 'Bun', pattern: /\bBun\s*[.[]/},
  {name: 'require', pattern: /\brequire\s*\(/},
];

describe('the assembler as a module', function () {
  it('should have source to scan, so the scans below can fail', async function () {
    expect((await code()).length).toBeGreaterThan(500);
  });

  it('should name neither the Rust boundary nor the Tauri api', async function () {
    const scanned = await code();
    const specifiers = [
      ...scanned.matchAll(STATIC_IMPORT),
      ...scanned.matchAll(DYNAMIC_IMPORT),
    ].map(function (match) {
      return match[1] ?? '';
    });

    expect(
      specifiers.filter(function (specifier) {
        return specifier.includes('bridge') || specifier.includes('@tauri-apps');
      }),
    ).toEqual([]);
  });

  it('should reach for no window, filesystem, network or runtime global', async function () {
    const scanned = await code();

    expect(
      HOST_GLOBALS.filter(function (capability) {
        return capability.pattern.test(scanned);
      }).map(function (capability) {
        return capability.name;
      }),
    ).toEqual([]);
  });
});

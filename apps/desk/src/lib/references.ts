import {ancestorGroups, type DocPath, type GroupPath} from '@inkling/vault';
import {estimateTokens} from './agent.ts';

/**
 * Assembling the references that reach one document.
 *
 * A reference is attached to a document or to a group, and a group's references
 * cascade down onto everything inside it, root-most group first and the
 * document's own last. That order is the reading order of the voice cascade,
 * and it lets the strip show inheritance depth without sorting anything again.
 *
 * Pure, the way `voice-cascade.ts` is pure. Bodies are looked up in the sources
 * the vault scan already loaded, never read from disk, and nothing here reaches
 * for the Rust boundary: `use-references.ts` fetches the rows and hands them in.
 *
 * There is no vault-root level. `docs/model.md` gives references to Group and
 * Document only, so a document at the vault root has its own references and
 * nothing above it.
 */

/**
 * A stored reference row, as `src-tauri/src/references.rs` returns it.
 *
 * A hand-written mirror of the Rust `Reference`, with
 * `serialises_to_the_shape_the_frontend_reads` in that file pinning the other
 * end. It lives here rather than in `bridge.ts`, which re-exports it, because
 * this is the module that reads it and this module may not name `bridge.ts`:
 * it would stop being loadable without a Tauri webview.
 */
export type StoredReference = {
  id: number;
  /** Set when a document owns it. Exactly one of this and `groupPath` is set. */
  docPath: string | null;
  /** Set when a group owns it, and then every document inside inherits it. */
  groupPath: string | null;
  kind: ReferenceKind;
  /** A vault-relative markdown path for a `doc` or a `note`, else null. */
  targetPath: string | null;
  /** A web address for a `link`, else null. */
  url: string | null;
  title: string;
  createdAt: string;
};

/** One inherited reference a document turned off, as `references.rs` returns it. */
export type StoredReferenceSuppression = {
  id: number;
  docPath: string;
  referenceId: number;
  createdAt: string;
};

export type ReferenceKind = 'doc' | 'link' | 'note';

/** Which level of the cascade an entry came from. */
export type ReferenceOrigin = {level: 'document'} | {level: 'group'; group: GroupPath};

export type ContextReference = {
  id: number;
  kind: ReferenceKind;
  title: string;
  /**
   * What the turn would carry. Empty for a link, for a missing file, and for an
   * inherited reference this document turned off, so a caller that totals the
   * sources cannot disagree with what the strip shows.
   */
  source: string;
  /** The vault path for a doc or a note, the URL for a link. */
  target: string;
  origin: ReferenceOrigin;
  /** A doc or note reference naming a file the vault no longer holds. */
  missing: boolean;
  /**
   * The id of the row turning this off for the open document, when one does.
   * Only ever set on an inherited entry: a document's own reference is detached
   * rather than turned off.
   */
  suppressedBy: number | undefined;
  tokens: number;
};

/** The rows one level owns, oldest first, so the output is stable. */
function ownedBy(
  rows: readonly StoredReference[],
  column: 'docPath' | 'groupPath',
  path: string,
): StoredReference[] {
  return rows
    .filter(function (row) {
      return row[column] === path;
    })
    .sort(function (a, b) {
      return a.id - b.id;
    });
}

function entryOf(
  row: StoredReference,
  origin: ReferenceOrigin,
  sources: ReadonlyMap<DocPath, string>,
  suppressedBy: number | undefined,
): ContextReference {
  const target = row.kind === 'link' ? (row.url ?? '') : (row.targetPath ?? '');
  const body = row.kind === 'link' ? undefined : sources.get(target as DocPath);
  // A link carries no body and is not missing for want of one; only a doc or a
  // note names a file the vault could have lost.
  const missing = row.kind !== 'link' && body === undefined;
  const source = suppressedBy !== undefined || body === undefined ? '' : body;

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    source,
    target,
    origin,
    missing,
    suppressedBy,
    tokens: estimateTokens(source),
  };
}

/**
 * The cascade of references that reaches one document.
 *
 * Group entries come first, root-most group first, and the document's own come
 * last. A doc or note row naming a file that is not in `sources` comes back
 * `missing`, contributing nothing and never sent: the row is kept because a
 * writer who moves a file outside inkling should get it back when they move it
 * again, and a silently dropped attachment is the worse surprise.
 */
export function assembleReferences(
  docPath: DocPath | undefined,
  rows: readonly StoredReference[],
  sources: ReadonlyMap<DocPath, string>,
  suppressions: readonly StoredReferenceSuppression[] = [],
): ContextReference[] {
  if (docPath === undefined) return [];

  const off = new Map(
    suppressions
      .filter(function (row) {
        return row.docPath === docPath;
      })
      .map(function (row): [number, number] {
        return [row.referenceId, row.id];
      }),
  );

  const inherited = ancestorGroups(docPath).flatMap(function (group) {
    return ownedBy(rows, 'groupPath', group).map(function (row) {
      return entryOf(row, {level: 'group', group}, sources, off.get(row.id));
    });
  });

  const own = ownedBy(rows, 'docPath', docPath).map(function (row) {
    return entryOf(row, {level: 'document'}, sources, undefined);
  });

  return [...inherited, ...own];
}

/**
 * The one folder a note's markdown body is written to, at the vault root.
 *
 * One obvious folder in Finder, and a note's path never drifts when the
 * document it belongs to moves between groups. Not under `.inkling/`: that
 * directory has to stay discardable, and a note the writer wrote is not.
 */
export const NOTE_DIR = 'references';

/** The next free `stem-N.md`, counting from the bare `stem.md`. */
function freeName(folder: string, stem: string, taken: ReadonlySet<string>, n: number): string {
  const path = n === 1 ? `${folder}/${stem}.md` : `${folder}/${stem}-${n}.md`;
  return taken.has(path) ? freeName(folder, stem, taken, n + 1) : path;
}

/**
 * The path a note's title becomes, uniquified against what the vault holds.
 *
 * Two notes a writer titles the same way slug to the same filename, and
 * `create_doc` refuses to overwrite, so the second one has to become `-2`
 * rather than an error the writer has to read and act on.
 */
export function notePathFor(
  title: string,
  taken: ReadonlySet<string>,
  folder: string = NOTE_DIR,
): DocPath {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return freeName(folder, slug.length === 0 ? 'note' : slug, taken, 1) as DocPath;
}

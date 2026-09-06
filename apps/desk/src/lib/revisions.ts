import type {DocPath} from '@inkling/vault';

/**
 * Stored revisions, as rows and as the calls that reach them.
 *
 * Pure, the way `conversations.ts` is pure: the row shapes live here and nothing
 * in this file names `bridge.ts`. What actually reaches the database is
 * {@link RevisionStore}, implemented once in `bridge.ts` and passed in from
 * `App.tsx`, so the hook is drivable with no webview.
 */

/**
 * One revision without its text, as `src-tauri/src/revisions.rs` returns it.
 *
 * A hand-written mirror of the Rust `RevisionSummary`, with
 * `serialises_to_the_shape_the_frontend_reads` in that file pinning the other
 * end.
 */
export type RevisionSummary = {
  id: number;
  docPath: string;
  createdAt: string;
};

/**
 * One revision with the document it holds.
 *
 * Separate from the summary rather than an optional `source` on it: a document
 * snapshotted often would otherwise carry every version of itself across the
 * boundary each time it was opened, to render a column of timestamps.
 */
export type Revision = RevisionSummary & {
  /** The whole document, frontmatter block and body together. */
  source: string;
};

/**
 * Everything a caller does to stored revisions, as one injected value.
 *
 * There is no remove: nothing in this app deletes a revision, and a document
 * that is deleted leaves its revisions behind, the way it leaves its
 * conversations and its dismissals. See `docs/model.md`.
 */
export type RevisionStore = {
  list: (docPath: DocPath) => Promise<RevisionSummary[]>;
  /** Keeps `source` as the document's next revision, resolving to the new row. */
  create: (docPath: DocPath, source: string) => Promise<RevisionSummary>;
  read: (id: number) => Promise<Revision>;
};

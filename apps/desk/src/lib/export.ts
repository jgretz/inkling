import {parseDoc} from '@inkling/vault';

/**
 * What leaves the app on the way to a file the writer picked. Pure: the save
 * dialog and the Rust write live in `App.tsx` and `bridge.ts`.
 */

/** Whether the exported file keeps the frontmatter block or drops it. */
export type FrontmatterChoice = 'keep' | 'strip';

/**
 * The bytes to write.
 *
 * Keeping is the buffer verbatim rather than a `serializeDoc` round trip: a
 * re-serialise reorders the `extra` keys and reflows YAML the writer typed by
 * hand, and an export is a copy of their file, not a rewrite of it.
 */
export function exportSource(source: string, choice: FrontmatterChoice): string {
  return choice === 'strip' ? parseDoc(source).body : source;
}

/** The last segment of a path, which is what the save dialog offers as a name. */
export function exportFileName(docPath: string): string {
  return docPath.split('/').filter(Boolean).pop() ?? docPath;
}

/**
 * The directory a chosen path sits in, or `undefined` when it names no
 * directory at all. What gets remembered for the next export.
 */
export function exportDirectory(chosenPath: string): string | undefined {
  const cut = chosenPath.lastIndexOf('/');
  if (cut < 0) return undefined;
  // A file at the filesystem root: the directory is `/`, not the empty string.
  return cut === 0 ? '/' : chosenPath.slice(0, cut);
}

/**
 * What the save dialog opens on: the document's own file name, in the directory
 * the last export landed in when there was one.
 */
export function defaultExportPath(lastDir: string | undefined, docPath: string): string {
  const name = exportFileName(docPath);
  if (lastDir === undefined) return name;
  return lastDir.endsWith('/') ? `${lastDir}${name}` : `${lastDir}/${name}`;
}

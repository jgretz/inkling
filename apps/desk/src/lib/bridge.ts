import {invoke} from '@tauri-apps/api/core';
import type {DocPath, GroupPath, VaultPath} from '@inkling/vault';

/**
 * The typed edge of the Rust command surface. Every `invoke` in the app goes
 * through a function here, so the command names and their argument shapes live
 * in exactly one file and the rest of the frontend never sees a string key.
 */

/** A markdown file as `src-tauri/src/vault.rs` returns it. */
export type DocFile = {
  path: string;
  source: string;
  /** Millisecond epoch as a string; `isoFromEpoch` turns it into a timestamp. */
  mtime: string;
};

/** Whether the app is running inside the Tauri webview rather than a browser. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Converts the Rust side's millisecond epoch string into an ISO 8601 UTC one. */
export function isoFromEpoch(mtime: string): string {
  const millis = Number(mtime);
  if (!Number.isFinite(millis) || millis <= 0) return new Date(0).toISOString();
  return new Date(millis).toISOString();
}

export function listDocs(vault: VaultPath): Promise<DocFile[]> {
  return invoke<DocFile[]>('list_docs', {vault});
}

/**
 * Every directory in the vault, so a group with nothing in it yet still shows.
 * `list_docs` returns files, and an empty group holds none.
 */
export function listGroups(vault: VaultPath): Promise<string[]> {
  return invoke<string[]>('list_groups', {vault});
}

export function createGroup(vault: VaultPath, path: GroupPath): Promise<void> {
  return invoke<void>('create_group', {vault, path});
}

/**
 * Renames a group, carrying everything stored against the documents inside it.
 * See the doc comment on `rename_group` in `src-tauri/src/vault.rs` for the
 * order the two halves happen in.
 */
export function renameGroup(vault: VaultPath, from: GroupPath, to: GroupPath): Promise<void> {
  return invoke<void>('rename_group', {vault, from, to});
}

export function readDoc(vault: VaultPath, path: DocPath): Promise<DocFile> {
  return invoke<DocFile>('read_doc', {vault, path});
}

/** Resolves to the file's new mtime, so the caller can settle its dirty state. */
export function writeDoc(vault: VaultPath, path: DocPath, source: string): Promise<string> {
  return invoke<string>('write_doc', {vault, path, source});
}

/**
 * Writes a document that is not there yet, rejecting if one already is.
 * `writeDoc` overwrites because the autosave needs it to; a create must not.
 */
export function createDoc(vault: VaultPath, path: DocPath, source: string): Promise<void> {
  return invoke<void>('create_doc', {vault, path, source});
}

export function renameDoc(vault: VaultPath, from: DocPath, to: DocPath): Promise<void> {
  return invoke<void>('rename_doc', {vault, from, to});
}

export function deleteDoc(vault: VaultPath, path: DocPath): Promise<void> {
  return invoke<void>('delete_doc', {vault, path});
}

/** What `src-tauri/src/data.rs` reports about the vault's database. */
export type VaultDbStatus =
  {kind: 'ready'; schemaVersion: number} | {kind: 'unavailable'; message: string};

/**
 * Opens (creating and migrating as needed) the database in the vault's
 * `.inkling/` directory. Rejects only when the vault root is not a directory;
 * every other failure comes back as an `unavailable` status.
 */
export function openVaultDb(vault: VaultPath): Promise<VaultDbStatus> {
  return invoke<VaultDbStatus>('open_vault_db', {vault});
}

/**
 * A dismissed finding, as `src-tauri/src/voice.rs` returns it.
 *
 * A hand-written mirror of the Rust `Suppression`, the way `VaultDbStatus` is,
 * with `serialises_to_the_shape_the_frontend_reads` in `voice.rs` pinning the
 * other end. The anchor's four fields are flat here because they are flat in
 * the table.
 */
export type StoredSuppression = {
  id: number;
  docPath: string;
  ruleId: string;
  quote: string;
  prefix: string;
  suffix: string;
  hint: number;
  createdAt: string;
};

export function listSuppressions(docPath: DocPath): Promise<StoredSuppression[]> {
  return invoke<StoredSuppression[]>('list_suppressions', {docPath});
}

/** Resolves to the stored row, whether this call created it or an earlier one did. */
export function addSuppression(
  docPath: DocPath,
  ruleId: string,
  anchor: {quote: string; prefix: string; suffix: string; hint: number},
): Promise<StoredSuppression> {
  return invoke<StoredSuppression>('add_suppression', {
    docPath,
    ruleId,
    quote: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    hint: anchor.hint,
  });
}

export function removeSuppression(id: number): Promise<void> {
  return invoke<void>('remove_suppression', {id});
}

export function loadSettings(): Promise<unknown> {
  return invoke<unknown>('load_settings');
}

export function saveSettings(settings: unknown): Promise<void> {
  return invoke<void>('save_settings', {settings});
}

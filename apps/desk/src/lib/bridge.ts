import {invoke} from '@tauri-apps/api/core';
import type {DocPath, VaultPath} from '@inkling/vault';

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

export function readDoc(vault: VaultPath, path: DocPath): Promise<DocFile> {
  return invoke<DocFile>('read_doc', {vault, path});
}

/** Resolves to the file's new mtime, so the caller can settle its dirty state. */
export function writeDoc(vault: VaultPath, path: DocPath, source: string): Promise<string> {
  return invoke<string>('write_doc', {vault, path, source});
}

export function renameDoc(vault: VaultPath, from: DocPath, to: DocPath): Promise<void> {
  return invoke<void>('rename_doc', {vault, from, to});
}

export function deleteDoc(vault: VaultPath, path: DocPath): Promise<void> {
  return invoke<void>('delete_doc', {vault, path});
}

export function loadSettings(): Promise<unknown> {
  return invoke<unknown>('load_settings');
}

export function saveSettings(settings: unknown): Promise<void> {
  return invoke<void>('save_settings', {settings});
}

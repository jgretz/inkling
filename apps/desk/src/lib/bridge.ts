import {invoke} from '@tauri-apps/api/core';
import type {DocPath, GroupPath, VaultPath} from '@inkling/vault';
import type {ReferenceKind, StoredReference, StoredReferenceSuppression} from './references.ts';
import type {Conversation, ConversationStore, StoredTurn, TurnState} from './conversations.ts';

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

/**
 * The stored row shapes, re-exported so callers reach one module for the wire.
 *
 * They are declared in `references.ts` rather than here because the assembler
 * that reads them must not name this file: it imports `@tauri-apps/api`, which
 * a test with no webview cannot load. `serialises_to_the_shape_the_frontend_reads`
 * in `src-tauri/src/references.rs` pins the other end of both.
 */
export type {StoredReference, StoredReferenceSuppression};

/** Who a reference is attached to, flattened into the two columns below. */
export type ReferenceOwner = {kind: 'doc'; path: DocPath} | {kind: 'group'; path: GroupPath};

export type NewReference = {
  owner: ReferenceOwner;
  kind: ReferenceKind;
  title: string;
  /** The vault path for a `doc` or a `note`. */
  targetPath?: DocPath;
  /** The address for a `link`. */
  url?: string;
};

/** Every reference in the vault. The cascade is assembled from these app-side. */
export function listReferences(): Promise<StoredReference[]> {
  return invoke<StoredReference[]>('list_references');
}

/**
 * Attaches a reference, resolving to the stored row whether this call created
 * it or an earlier one did.
 *
 * The owner is a discriminated union here and two nullable columns on the wire,
 * so no caller ever assembles the pair by hand and gets both set. Both keys are
 * sent explicitly, `null` for the one that is not in play.
 */
export function addReference(reference: NewReference): Promise<StoredReference> {
  return invoke<StoredReference>('add_reference', {
    docPath: reference.owner.kind === 'doc' ? reference.owner.path : null,
    groupPath: reference.owner.kind === 'group' ? reference.owner.path : null,
    kind: reference.kind,
    targetPath: reference.targetPath ?? null,
    url: reference.url ?? null,
    title: reference.title,
  });
}

/** Removes the row. A note's markdown body, if it had one, is left alone. */
export function removeReference(id: number): Promise<void> {
  return invoke<void>('remove_reference', {id});
}

export function listReferenceSuppressions(): Promise<StoredReferenceSuppression[]> {
  return invoke<StoredReferenceSuppression[]>('list_reference_suppressions');
}

/** Turns one inherited reference off for one document, leaving the group's row. */
export function addReferenceSuppression(
  docPath: DocPath,
  referenceId: number,
): Promise<StoredReferenceSuppression> {
  return invoke<StoredReferenceSuppression>('add_reference_suppression', {docPath, referenceId});
}

export function removeReferenceSuppression(id: number): Promise<void> {
  return invoke<void>('remove_reference_suppression', {id});
}

/**
 * The stored conversation shapes, re-exported so callers reach one module for
 * the wire.
 *
 * Declared in `conversations.ts` for the same reason the reference rows are
 * declared in `references.ts`: the transform that reads them must not name this
 * file, which imports `@tauri-apps/api`.
 * `serialises_to_the_shape_the_frontend_reads` in `src-tauri/src/conversations.rs`
 * pins the other end of both.
 */
export type {Conversation, StoredTurn};

export function listConversations(docPath: DocPath): Promise<Conversation[]> {
  return invoke<Conversation[]>('list_conversations', {docPath});
}

/** Resolves to the row the database created, whose id every later call needs. */
export function createConversation(docPath: DocPath, title: string): Promise<Conversation> {
  return invoke<Conversation>('create_conversation', {docPath, title});
}

export function renameConversation(id: number, title: string): Promise<void> {
  return invoke<void>('rename_conversation', {id, title});
}

/** Removes the conversation and, through the table's cascade, its turns. */
export function deleteConversation(id: number): Promise<void> {
  return invoke<void>('delete_conversation', {id});
}

/**
 * Points a conversation at a daemon session, or at none.
 *
 * Both ids are sent explicitly, `null` for the one that is not in play, because
 * they only mean anything as a pair: an evicted conversation keeps its resume id
 * and loses its session id.
 */
export function setConversationSession(
  id: number,
  sessionId: string | null,
  resumeSessionId: string | null,
): Promise<void> {
  return invoke<void>('set_conversation_session', {id, sessionId, resumeSessionId});
}

export function listTurns(conversationId: number): Promise<StoredTurn[]> {
  return invoke<StoredTurn[]>('list_turns', {conversationId});
}

/** Records a turn as asked, with the document as it stood before it. */
export function startTurn(
  conversationId: number,
  asked: string,
  snapshot: string,
): Promise<StoredTurn> {
  return invoke<StoredTurn>('start_turn', {conversationId, asked, snapshot});
}

/** Ends a turn. `answered` carries the reply, or the failure's own words. */
export function finishTurn(
  id: number,
  state: Exclude<TurnState, 'pending'>,
  answered: string | null,
): Promise<StoredTurn> {
  return invoke<StoredTurn>('finish_turn', {id, state, answered});
}

/**
 * The eight calls above as one value, which is what the transport and the
 * conversation hook actually take.
 *
 * Assembled here and passed down from `App.tsx` rather than imported where it is
 * used, so neither of those modules names this file and both stay drivable with
 * no webview. See `ConversationStore` in `conversations.ts`.
 */
export const tauriConversations: ConversationStore = {
  list: listConversations,
  create: createConversation,
  rename: renameConversation,
  remove: deleteConversation,
  setSession: setConversationSession,
  listTurns,
  startTurn,
  finishTurn,
};

export function loadSettings(): Promise<unknown> {
  return invoke<unknown>('load_settings');
}

export function saveSettings(settings: unknown): Promise<void> {
  return invoke<void>('save_settings', {settings});
}

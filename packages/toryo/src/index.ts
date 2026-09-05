/**
 * What a consumer of this package may name.
 *
 * The client and the types its methods mention, and nothing else. The frame
 * reader, the two mappings onto those types and the status guard are how the
 * client is built rather than what it offers, and the two wire literals are its
 * own address; all of them stay behind this file, and the tests that cover them
 * import their module directly. Widening this is a decision about the package's
 * surface, not a convenience.
 */

export {createHeldSessionClient, HeldStreamError} from './held.ts';

export type {
  HeldResult,
  HeldSessionClient,
  HeldSessionError,
  HeldSessionOptions,
  HeldSessionState,
  HeldSessionStatus,
  HeldStreamFrame,
  HeldStreamTurn,
} from './held.ts';

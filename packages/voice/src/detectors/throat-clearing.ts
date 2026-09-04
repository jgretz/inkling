import {matchPhrases} from '../match.ts';
import {THROAT_CLEARING} from '../words.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'throat-clearing';

/**
 * Filler that can be deleted with the sentence left intact. Every entry's fix
 * is the same shape for that reason: delete it, keep what it was introducing.
 */
export const throatClearing: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, THROAT_CLEARING);
  },
};

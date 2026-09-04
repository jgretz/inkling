import {matchPhrases} from '../match.ts';
import {SIGNPOSTING} from '../words.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'signposting';

/**
 * Telling the reader what the piece is about to do instead of doing it. A
 * lecture habit that survives into prose, where there is no room to stand.
 */
export const signposting: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, SIGNPOSTING);
  },
};

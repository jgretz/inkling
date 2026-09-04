import {matchPhrases} from '../match.ts';
import {NEGATIVE_PARALLELISM} from '../words.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'negative-parallelism';

/**
 * `Not X, but Y`, and the two-sentence version of the same move. It reads as
 * emphasis and is almost always a sentence explaining what it is not before it
 * gets round to what it is.
 */
export const negativeParallelism: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, NEGATIVE_PARALLELISM);
  },
};

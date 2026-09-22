import {matchPhrases} from '../match.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'em-dash';

/**
 * House style, not a detector of authorship: every em dash has better
 * punctuation waiting for it, and a writer can always fix one.
 */
export const emDash: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, [
      {
        pattern: /—/g,
        explain:
          'use a colon if the second half explains the first, a comma for an aside, or a full stop.',
      },
    ]);
  },
};

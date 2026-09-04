import {matchPhrases} from '../match.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'not-only-but';

/**
 * `Not only X, but also Y`. A correlative that promises two things and usually
 * delivers one thing twice.
 */
export const notOnlyBut: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, [
      {
        pattern: /\bnot only\b[^.!?\n]{0,80}?\bbut\b(?:[ \t]+also\b)?/gi,
        explain: 'keep the half that carries the argument and cut the correlative.',
      },
    ]);
  },
};

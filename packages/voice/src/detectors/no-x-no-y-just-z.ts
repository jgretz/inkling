import {matchPhrases} from '../match.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'no-x-no-y-just-z';

/**
 * `No servers, no config, just files.` A rhythm rather than a sentence, and one
 * that describes a product by listing what it lacks.
 */
export const noXNoYJustZ: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, [
      {
        pattern:
          /\bno[ \t]+[^,.;:!?\n]{1,30},[ \t]*no[ \t]+[^,.;:!?\n]{1,30},[ \t]*(?:just|only|simply)\b/gi,
        explain: 'say what it does instead of listing what it does without.',
      },
    ]);
  },
};

import {matchPhrases} from '../match.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'curly-quotes';

/**
 * Typographic quotes and apostrophes in a markdown source file. The renderer is
 * where curly quotes belong; in the source they are a character a writer cannot
 * type, which means something else typed them.
 */
export const curlyQuotes: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, [
      {
        pattern: /[‘’“”]/g,
        explain: 'replace it with a straight quote so the source stays typeable.',
      },
    ]);
  },
};

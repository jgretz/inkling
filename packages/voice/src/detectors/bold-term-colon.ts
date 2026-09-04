import {matchPhrases} from '../match.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'bold-term-colon';

const EXPLAIN = 'write it as a sentence. A definition list is a slide, not prose.';

/**
 * `**Term**: explanation`, the shape a model reaches for whenever it has three
 * things to say. Needs the emphasis markers, which is why the extractor leaves
 * markup in the reduced text instead of stripping it the way a word count would.
 */
export const boldTermColon: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, [
      {
        pattern: /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?\*\*[^*\n]{1,60}\*\*[ \t]*:/gm,
        explain: EXPLAIN,
      },
      {
        pattern: /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?\*\*[^*\n]{1,60}:\*\*/gm,
        explain: EXPLAIN,
      },
    ]);
  },
};

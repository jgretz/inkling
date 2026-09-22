import {matchPhrases} from '../match.ts';
import {AUTOMATIC_INTERPRETATION} from '../words.ts';
import type {Detector} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'automatic-interpretation';

/**
 * A fact followed by what it supposedly shows: `the team shipped on time,
 * highlighting its commitment to quality`. The clause after the comma is the
 * writer grading their own evidence.
 *
 * One false positive knowingly survives the table: a literal participle after a
 * comma, as in `the lake lay still, reflecting the light`, or a relative clause
 * like `the glass, which reflects the lamp`. Telling commentary from
 * description needs to know whether the object is an abstraction, which this
 * package has no way to know. The finding is cheap to dismiss when it is wrong.
 */
export const automaticInterpretation: Detector = {
  id: ID,
  run: function (prose) {
    return matchPhrases(prose, ID, AUTOMATIC_INTERPRETATION);
  },
};

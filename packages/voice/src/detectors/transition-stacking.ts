import {THRESHOLDS} from '../constants.ts';
import {findingAt, spansMask} from '../prose.ts';
import {FORMAL_CONNECTIVES} from '../words.ts';
import type {Detector, Finding, Prose, Sentence} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'transition-stacking';

const EXPLAIN = 'cut the connectives and let the order of the sentences carry the argument.';

/** A connective only counts when it opens the sentence and is punctuated as one. */
function opensWithConnective(text: string): boolean {
  const lower = text.toLowerCase();
  return FORMAL_CONNECTIVES.some(function (connective) {
    if (!lower.startsWith(connective)) return false;
    const next = lower[connective.length];
    return next === undefined || next === ',' || next === ' ' || next === ':';
  });
}

/** Maximal runs of consecutive sentences that each open with a connective. */
function connectiveRuns(prose: Prose): Sentence[][] {
  return prose.sentences.reduce<Sentence[][]>(function (runs, sentence) {
    const block = prose.blocks[sentence.blockIndex];
    const text = prose.text.slice(sentence.start, sentence.end);
    // A heading between two paragraphs breaks the run: they are not consecutive
    // to a reader, whatever the sentence list says.
    if (block?.kind === 'heading' || !opensWithConnective(text)) {
      runs.push([]);
      return runs;
    }

    const current = runs[runs.length - 1];
    if (current === undefined) runs.push([sentence]);
    else current.push(sentence);
    return runs;
  }, []);
}

/**
 * Three sentences in a row opening `However`, `Moreover`, `Furthermore`. Two is
 * a writer joining an argument up; three is a template being filled in.
 */
export const transitionStacking: Detector = {
  id: ID,
  run: function (prose): Finding[] {
    return connectiveRuns(prose)
      .filter(function (run) {
        return run.length >= THRESHOLDS.connectiveRun;
      })
      .flatMap(function (run) {
        const start = run[0]?.start;
        const end = run[run.length - 1]?.end;
        if (start === undefined || end === undefined) return [];
        if (spansMask(prose, start, end)) return [];
        return [findingAt(prose, ID, start, end, EXPLAIN)];
      });
  },
};

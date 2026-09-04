import {findingAt, spansMask} from '../prose.ts';
import {BANNED_OPENERS} from '../words.ts';
import type {Detector, Finding, Prose, Sentence} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'banned-openers';

/**
 * Scene-setting formulas, matched only at the start of a sentence.
 *
 * `When it comes to` mid-sentence is doing work; opening with it is a writer
 * clearing space before saying anything. The sentence list is what makes the
 * distinction cheap.
 */
function openerFinding(prose: Prose, sentence: Sentence): Finding | undefined {
  const text = prose.text.slice(sentence.start, sentence.end);

  for (const rule of BANNED_OPENERS) {
    const match = text.match(rule.pattern);
    if (match === null) continue;

    const start = sentence.start;
    const end = start + match[0].length;
    if (spansMask(prose, start, end)) continue;
    return findingAt(prose, ID, start, end, rule.explain);
  }

  return undefined;
}

export const bannedOpeners: Detector = {
  id: ID,
  run: function (prose) {
    return prose.sentences.flatMap(function (sentence) {
      const finding = openerFinding(prose, sentence);
      return finding === undefined ? [] : [finding];
    });
  },
};

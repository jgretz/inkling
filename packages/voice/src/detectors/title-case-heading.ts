import {findingAt, spansMask} from '../prose.ts';
import {contentStart} from '../sentences.ts';
import {TITLE_CASE_COMMON_WORDS} from '../words.ts';
import type {Detector, Finding, ProseBlock, Prose, VoiceThresholds} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'title-case-heading';

const WORD = /[\p{L}][\p{L}\p{N}'’-]*/gu;

/** Capitalised in the ordinary way, so `API` and `iPhone` are left out of it. */
const TITLE_CASED = /^\p{Lu}\p{Ll}+$/u;

const EXPLAIN = 'use sentence case: capitalise the first word and any proper nouns, nothing else.';

/**
 * A heading is Title Case when a word that is never part of a name is
 * capitalised somewhere after the first word.
 *
 * The negative test is the point. `New York Times` and `The Sense of Style` are
 * capitalised for a reason the checker has no way to argue with, and a rule
 * that flags them is a rule that gets switched off.
 */
function isTitleCase(heading: string, minWords: number): boolean {
  const words = [...heading.matchAll(WORD)];
  if (words.length < minWords) return false;

  return words.slice(1).some(function (match) {
    const word = match[0];
    return TITLE_CASED.test(word) && TITLE_CASE_COMMON_WORDS.includes(word.toLowerCase());
  });
}

function headingFinding(
  prose: Prose,
  block: ProseBlock,
  thresholds: VoiceThresholds,
): Finding | undefined {
  const start = contentStart(prose.text, block);
  const heading = prose.text.slice(start, block.end).trimEnd();
  const end = start + heading.length;

  if (!isTitleCase(heading, thresholds.titleCaseMinWords)) return undefined;
  if (spansMask(prose, start, end)) return undefined;

  return findingAt(prose, ID, start, end, EXPLAIN);
}

export const titleCaseHeading: Detector = {
  id: ID,
  run: function (prose, thresholds) {
    return prose.blocks
      .filter(function (block) {
        return block.kind === 'heading';
      })
      .flatMap(function (block) {
        const finding = headingFinding(prose, block, thresholds);
        return finding === undefined ? [] : [finding];
      });
  },
};

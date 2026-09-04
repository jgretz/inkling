import {findingAt} from '../prose.ts';
import type {Detector, Finding, Prose, ProseBlock, VoiceThresholds} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'sentence-length-uniformity';

const EXPLAIN = 'break the rhythm: cut one sentence in half, or join two of them.';

/** Population standard deviation over the mean. Zero mean cannot be uniform. */
function spread(counts: number[]): number {
  const mean =
    counts.reduce(function (total, count) {
      return total + count;
    }, 0) / counts.length;
  if (mean === 0) return Infinity;

  const variance =
    counts.reduce(function (total, count) {
      return total + (count - mean) ** 2;
    }, 0) / counts.length;

  return Math.sqrt(variance) / mean;
}

function uniformParagraph(
  prose: Prose,
  block: ProseBlock,
  index: number,
  thresholds: VoiceThresholds,
): Finding | undefined {
  if (block.kind !== 'paragraph') return undefined;

  const counts = prose.sentences
    .filter(function (sentence) {
      return sentence.blockIndex === index;
    })
    .map(function (sentence) {
      return sentence.words;
    });

  if (counts.length < thresholds.uniformityMinSentences) return undefined;
  if (spread(counts) >= thresholds.uniformityRatio) return undefined;

  return findingAt(prose, ID, block.start, block.end, EXPLAIN);
}

/**
 * A paragraph whose sentences are all the same length.
 *
 * Below four sentences the statistic says nothing, so short paragraphs are left
 * alone. The block, not the sentence, is what gets flagged: no one sentence is
 * wrong, and the fix is to the paragraph's rhythm.
 */
export const sentenceLengthUniformity: Detector = {
  id: ID,
  run: function (prose, thresholds) {
    return prose.blocks.flatMap(function (block, index) {
      const finding = uniformParagraph(prose, block, index, thresholds);
      return finding === undefined ? [] : [finding];
    });
  },
};

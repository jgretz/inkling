export {check} from './check.ts';
export {createAnchor, resolveAnchor} from './anchor.ts';
export {extract, findingAt, sentenceAt, spansMask, toSourceOffset} from './prose.ts';
export {DETECTORS, DETECTORS_BY_ID} from './registry.ts';
export {DEFAULT_DETECTORS, THRESHOLDS} from './constants.ts';

export type {
  Anchor,
  BannedWord,
  CheckOptions,
  Detector,
  Finding,
  PhraseRule,
  Prose,
  ProseBlock,
  ProseSegment,
  Range,
  Sentence,
} from './types.ts';

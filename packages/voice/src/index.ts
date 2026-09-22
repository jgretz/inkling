export {check} from './check.ts';
export {
  createAnchor,
  MIN_CONTEXT_AGREEMENT,
  resolveAnchor,
  resolveAnchorScored,
  resolvePassage,
} from './anchor.ts';
export {extract, findingAt, sentenceAt, spansMask, toSourceOffset} from './prose.ts';
export {DETECTORS, DETECTORS_BY_ID} from './registry.ts';
export {DEFAULT_DETECTORS, DEFAULT_VOICE_THRESHOLDS, THRESHOLDS} from './constants.ts';
export {parseRuleSet, resolveVoice} from './rules.ts';
export {applySuppressions} from './suppress.ts';

export type {ResolvedAnchor} from './anchor.ts';
export type {ResolvedVoice, VoiceRuleSet} from './rules.ts';
export type {SuppressedFinding, Suppression} from './suppress.ts';

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
  VoiceThresholds,
} from './types.ts';

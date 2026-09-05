import {DEFAULT_DETECTORS, DEFAULT_VOICE_THRESHOLDS} from './constants.ts';
import {DETECTORS, DETECTORS_BY_ID} from './registry.ts';
import type {VoiceThresholds} from './types.ts';

/**
 * A writer's rule set, already parsed out of whatever carried it.
 *
 * The package cannot read a file and cannot parse YAML: it takes the object
 * some caller's parser produced and validates it. `guidance` is the prose the
 * writer wrote around the configuration, kept whole for the agent prompt
 * roadmap 4.5 assembles.
 */
export type VoiceRuleSet = {
  rules: Readonly<Record<string, boolean>>;
  thresholds: Readonly<Partial<VoiceThresholds>>;
  guidance: string;
};

/** What a cascade of rule sets says about one document. */
export type ResolvedVoice = {
  /** Detector ids to run, in registry order, ready for `CheckOptions`. */
  detectors: readonly string[];
  thresholds: VoiceThresholds;
  /** Every level's guidance, root first, with the empty ones dropped. */
  guidance: readonly string[];
};

const THRESHOLD_KEYS = Object.keys(DEFAULT_VOICE_THRESHOLDS) as Array<keyof VoiceThresholds>;

/**
 * YAML 1.2's core schema, which is what this project's parser uses, reads `on`
 * and `off` as strings rather than booleans. A writer typing `em-dash: off`
 * means off, so the strings are accepted alongside the booleans they look like.
 */
const TRUTHY = ['true', 'on', 'yes'];
const FALSY = ['false', 'off', 'no'];

function asToggle(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase();
  if (TRUTHY.includes(word)) return true;
  if (FALSY.includes(word)) return false;
  return undefined;
}

function isThresholdKey(key: string): key is keyof VoiceThresholds {
  return (THRESHOLD_KEYS as readonly string[]).includes(key);
}

/** A plain object, which is the only thing either half of a rule set may be. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseRules(raw: unknown, problems: string[]): Record<string, boolean> {
  const rules: Record<string, boolean> = {};
  if (raw === undefined) return rules;

  const record = asRecord(raw);
  if (record === undefined) {
    problems.push('rules: expected a block of rule ids, one per line');
    return rules;
  }

  Object.entries(record).forEach(function ([id, value]) {
    if (!DETECTORS_BY_ID.has(id)) {
      problems.push(`rules.${id}: no rule by that name, so it would do nothing`);
      return;
    }
    const toggle = asToggle(value);
    // Never coerced to `false`: a typo that silently disabled a rule would be
    // indistinguishable from a rule the writer meant to turn off.
    if (toggle === undefined) {
      problems.push(`rules.${id}: expected on or off, so this rule is left as it was`);
      return;
    }
    rules[id] = toggle;
  });

  return rules;
}

function parseThresholds(raw: unknown, problems: string[]): Partial<VoiceThresholds> {
  const thresholds: Partial<VoiceThresholds> = {};
  if (raw === undefined) return thresholds;

  const record = asRecord(raw);
  if (record === undefined) {
    problems.push('thresholds: expected a block of numbers, one per line');
    return thresholds;
  }

  Object.entries(record).forEach(function ([key, value]) {
    if (!isThresholdKey(key)) {
      problems.push(`thresholds.${key}: no threshold by that name`);
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      problems.push(`thresholds.${key}: expected a number above zero`);
      return;
    }
    thresholds[key] = value;
  });

  return thresholds;
}

/**
 * Validates one level of a cascade.
 *
 * `raw` is whatever the caller's frontmatter parser produced, so everything in
 * it is suspect. Anything unrecognised is reported in `problems` and dropped,
 * never guessed at: a rule set is the writer's instruction to the checker, and
 * a silent misreading of one is worse than no rule set at all.
 */
export function parseRuleSet(
  raw: unknown,
  guidance: string,
): {ruleSet: VoiceRuleSet; problems: string[]} {
  const problems: string[] = [];
  const record = asRecord(raw);

  if (record === undefined) {
    if (raw !== undefined && raw !== null)
      problems.push('expected a block of rules and thresholds');
    return {ruleSet: {rules: {}, thresholds: {}, guidance}, problems};
  }

  const rules = parseRules(record['rules'], problems);
  const thresholds = parseThresholds(record['thresholds'], problems);

  return {ruleSet: {rules, thresholds, guidance}, problems};
}

/**
 * Layers a cascade of rule sets into what `check` needs.
 *
 * Sets arrive root first and the document's own last, and the last level to
 * mention a key wins it, for a rule and for a threshold alike. Full override
 * rather than narrowing: a document that may lower a threshold but not re-enable
 * a rule its group turned off is a rule nobody can hold in their head.
 */
export function resolveVoice(sets: readonly VoiceRuleSet[]): ResolvedVoice {
  const enabled = new Map<string, boolean>(
    DEFAULT_DETECTORS.map(function (id): [string, boolean] {
      return [id, true];
    }),
  );
  let thresholds: VoiceThresholds = DEFAULT_VOICE_THRESHOLDS;
  const guidance: string[] = [];

  sets.forEach(function (set) {
    Object.entries(set.rules).forEach(function ([id, on]) {
      enabled.set(id, on);
    });
    thresholds = {...thresholds, ...set.thresholds};
    if (set.guidance.trim().length > 0) guidance.push(set.guidance);
  });

  // Registry order rather than cascade order, so the detector list reads the
  // same however many levels touched it.
  const detectors = DETECTORS.filter(function (detector) {
    return enabled.get(detector.id) === true;
  }).map(function (detector) {
    return detector.id;
  });

  return {detectors, thresholds, guidance};
}

import type {Anchor, Finding, Suppression} from '@inkling/voice';
import type {StoredSuppression} from './bridge.ts';

/**
 * Display names for the checker's rules.
 *
 * `@inkling/voice` deliberately carries no human-readable title: a `Detector` is
 * `{id, run}` and a `Finding` is data about a position in text, neither of which
 * should know how an editor labels it. So the table lives here, on the app side
 * of the boundary, and `apps/desk/tests/voice-rules.test.ts` pins it to
 * `DETECTORS` so a new rule cannot ship unlabelled.
 *
 * The wording names the construction, not the verdict. A writer reading "Em
 * dash" can decide for themselves; "Overused punctuation" decides for them.
 */
export const RULE_LABELS: Record<string, string> = {
  'em-dash': 'Em dash',
  'en-dash-parenthetical': 'En dash as an aside',
  'spaced-hyphen': 'Spaced hyphen',
  'curly-quotes': 'Curly quotes',
  'negative-parallelism': 'False contrast',
  'not-only-but': 'Not only, but',
  'no-x-no-y-just-z': 'No X, no Y, just Z',
  'title-case-heading': 'Title Case heading',
  'bold-term-colon': 'Bold term with a colon',
  'banned-words': 'Banned word',
  'banned-openers': 'Banned opener',
  'throat-clearing': 'Throat clearing',
  signposting: 'Signposting',
  'rule-of-three': 'Rule of three',
  'transition-stacking': 'Stacked transitions',
  'sentence-length-uniformity': 'Uniform sentence length',
};

/** The label for a rule id, falling back to the id so nothing renders blank. */
export function ruleLabel(id: string): string {
  return RULE_LABELS[id] ?? id;
}

/**
 * A stored dismissal in the shape the pure matcher takes, with the row's id
 * kept alongside it.
 *
 * The id is what a restore deletes. It travels with the anchor rather than
 * being looked up afterwards, because after an edit the finding's own anchor is
 * no longer the one that was stored, so there is nothing to look it up by.
 */
export type Dismissal = Suppression & {id: number};

/** The stored row, flat as the table holds it, gathered back into an anchor. */
export function dismissalOf(row: StoredSuppression): Dismissal {
  return {
    id: row.id,
    ruleId: row.ruleId,
    anchor: {quote: row.quote, prefix: row.prefix, suffix: row.suffix, hint: row.hint},
  };
}

export type RuleGroup = {
  ruleId: string;
  label: string;
  findings: readonly Finding[];
};

/**
 * Findings gathered by rule, groups in first-appearance order and findings in
 * document order within each group.
 *
 * First appearance rather than alphabetical or registry order: the strip should
 * lead with whatever the writer will hit first when they scroll.
 */
export function groupFindings(findings: readonly Finding[]): RuleGroup[] {
  const groups = new Map<string, Finding[]>();

  findings.forEach(function (finding) {
    const existing = groups.get(finding.ruleId);
    if (existing === undefined) groups.set(finding.ruleId, [finding]);
    else existing.push(finding);
  });

  return [...groups.entries()].map(function ([ruleId, entries]): RuleGroup {
    return {ruleId, label: ruleLabel(ruleId), findings: entries};
  });
}

/** Characters of anchor context a strip entry keeps on each side. */
const CONTEXT_WIDTH = 24;

export type Snippet = {
  before: string;
  quote: string;
  after: string;
};

/**
 * One line of readable context for a finding.
 *
 * The quote alone is not enough to identify a finding: forty-three of the
 * fifty-seven findings in `examples/vault/personal-readme.md` come from
 * `spaced-hyphen`, whose quote is the single character `-`. The anchor's prefix
 * and suffix are what make those entries tell apart, so they are trimmed to a
 * width that fits a row rather than dropped.
 */
export function snippet(anchor: Anchor): Snippet {
  const before = anchor.prefix.slice(Math.max(0, anchor.prefix.length - CONTEXT_WIDTH));
  return {
    before: collapse(before),
    quote: collapse(anchor.quote),
    after: collapse(anchor.suffix.slice(0, CONTEXT_WIDTH)),
  };
}

/** Newlines and runs of whitespace become one space, so a row stays one row. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

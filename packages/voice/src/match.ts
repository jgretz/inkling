import {findingAt, spansMask} from './prose.ts';
import type {Finding, PhraseRule, Prose} from './types.ts';

/**
 * Runs a phrase table over the reduced text.
 *
 * Every table-driven detector is this loop, so it is written once: match, drop
 * anything that straddles a masked region, and hand the offsets to `findingAt`
 * to be turned back into positions in the writer's own document.
 */
export function matchPhrases(
  prose: Prose,
  ruleId: string,
  rules: readonly PhraseRule[],
): Finding[] {
  return rules.flatMap(function (rule) {
    return [...prose.text.matchAll(rule.pattern)]
      .filter(function (match) {
        return !spansMask(prose, match.index, match.index + match[0].length);
      })
      .map(function (match) {
        return findingAt(prose, ruleId, match.index, match.index + match[0].length, rule.explain);
      });
  });
}

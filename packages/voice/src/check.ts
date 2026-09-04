import {DEFAULT_DETECTORS} from './constants.ts';
import {extract} from './prose.ts';
import {DETECTORS} from './registry.ts';
import type {CheckOptions, Finding} from './types.ts';

/**
 * Runs the enabled detectors over a markdown document.
 *
 * The prose is extracted once and shared, which is what keeps this cheap enough
 * to run on a keystroke: sixteen detectors, one parse. Findings come back in
 * document order, and an id in `options.detectors` that no detector answers to
 * simply selects nothing.
 */
export function check(source: string, options?: CheckOptions): Finding[] {
  const enabled = new Set(options?.detectors ?? DEFAULT_DETECTORS);
  const prose = extract(source);

  return DETECTORS.filter(function (detector) {
    return enabled.has(detector.id);
  })
    .flatMap(function (detector) {
      return detector.run(prose);
    })
    .sort(function (a, b) {
      return a.range.start - b.range.start || a.range.end - b.range.end;
    });
}

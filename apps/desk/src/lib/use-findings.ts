import {useMemo} from 'react';
import {
  applySuppressions,
  check,
  type Finding,
  type ResolvedVoice,
  type SuppressedFinding,
} from '@inkling/voice';
import type {Dismissal} from './voice-rules.ts';

export type Findings = {
  /** What the strip and the editor marks show. */
  kept: readonly Finding[];
  /** What the writer dismissed, with the dismissal that silenced each. */
  suppressed: ReadonlyArray<SuppressedFinding<Dismissal>>;
};

/**
 * Every voice finding in the current draft, split into what to show and what
 * the writer already dismissed, recomputed on every change.
 *
 * Deliberately not debounced and deliberately not timed. `check` extracts the
 * prose once and runs sixteen detectors over it, and warm it costs a median of
 * 1.1ms over `examples/vault/personal-readme.md` (1,920 words) and 3.2ms over
 * three copies of it (5,760 words), measured across 60 iterations. That is
 * inside a frame, so a timer would buy nothing and would cost the thing this
 * whole phase exists for: a mark appearing within a keystroke of the
 * construction that earned it.
 *
 * Suppression adds one substring scan per dismissal to a document already being
 * scanned sixteen times, which does not change that.
 *
 * Findings are derived from the source, never held, so they cannot go stale.
 */
export function useFindings(
  source: string,
  voice: ResolvedVoice,
  dismissals: readonly Dismissal[],
): Findings {
  return useMemo(
    function () {
      const findings = check(source, {detectors: voice.detectors, thresholds: voice.thresholds});
      return applySuppressions(source, findings, dismissals);
    },
    [source, voice, dismissals],
  );
}

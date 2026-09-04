import {useMemo} from 'react';
import {check, type Finding} from '@inkling/voice';

/**
 * Every voice finding in the current draft, recomputed on every change.
 *
 * Deliberately not debounced and deliberately not timed. `check` extracts the
 * prose once and runs sixteen detectors over it, and warm it costs a median of
 * 1.1ms over `examples/vault/personal-readme.md` (1,920 words) and 3.2ms over
 * three copies of it (5,760 words), measured across 60 iterations. That is
 * inside a frame, so a timer would buy nothing and would cost the thing this
 * whole phase exists for: a mark appearing within a keystroke of the
 * construction that earned it.
 *
 * Findings are derived from the source, never held, so they cannot go stale.
 */
export function useFindings(source: string): readonly Finding[] {
  return useMemo(
    function () {
      return check(source);
    },
    [source],
  );
}

/**
 * Whose turn it is, derived from where focus last was.
 *
 * Pure: no React, no window, no clock. `docs/turn-taking.md` is the design, and
 * the table there is what {@link deriveMode} implements. Deriving the mode is
 * what kills the two-cursors problem rather than managing it, so nothing here
 * ever produces a read-only lock over the editor.
 */

/** Who may write the document without asking first. */
export type TurnMode = 'writer' | 'agent';

/** A mode the writer pinned by hand, or nothing pinned at all. */
export type TurnPin = TurnMode | undefined;

/** The two places focus can be that say anything about whose turn it is. */
export type FocusRegion = 'editor' | 'chat';

/** What the title bar shows: the two resting states, plus a write in flight. */
export type TurnIndicator = TurnMode | 'landing';

/** Where focus in each region leaves the turn, when nothing is pinned. */
const DERIVED: Record<FocusRegion, TurnMode> = {
  editor: 'writer',
  chat: 'agent',
};

/**
 * Whose turn it is now.
 *
 * A pin wins outright: a writer reading the preview still wants the agent
 * working, and nothing about focus can say so. With nothing pinned and no focus
 * yet, the writer's turn is the answer, because the mode that asks first is the
 * one you should get by default.
 */
export function deriveMode(lastFocus: FocusRegion | undefined, pin: TurnPin): TurnMode {
  if (pin !== undefined) return pin;
  if (lastFocus === undefined) return 'writer';
  return DERIVED[lastFocus];
}

/**
 * The next pin, one click on: unpinned, then the writer's turn, then the
 * agent's, then back to unpinned. Three states in one control because the pin
 * is an override and "no override" has to be reachable without a second one.
 */
export function cyclePin(pin: TurnPin): TurnPin {
  if (pin === undefined) return 'writer';
  if (pin === 'writer') return 'agent';
  return undefined;
}

/**
 * What to show while `landing` is true, which is the moment between an edit
 * being applied and the buffer holding what disk actually returned.
 */
export function indicatorFor(mode: TurnMode, landing: boolean): TurnIndicator {
  return landing ? 'landing' : mode;
}

const INDICATOR_LABEL: Record<TurnIndicator, string> = {
  writer: 'Your turn: the agent asks before it edits',
  agent: "The agent's turn: it may edit without asking",
  landing: 'The agent is writing the document',
};

/**
 * The indicator's accessible name, which says the state and whether a pin put
 * it there. It is the only place the pin is visible, so leaving it out would
 * make an overridden mode indistinguishable from a derived one.
 */
export function indicatorLabel(indicator: TurnIndicator, pinned: boolean): string {
  return `${INDICATOR_LABEL[indicator]}${pinned ? ' (pinned)' : ''}`;
}

import {describe, expect, it} from 'bun:test';
import {cyclePin, deriveMode, indicatorFor, indicatorLabel, type TurnPin} from '../src/lib/turn.ts';

/**
 * The rule in `docs/turn-taking.md`, as a table.
 *
 * The whole point of deriving the mode is that it is decidable without a
 * window, a focus event or a React tree, so this suite is arithmetic over two
 * arguments and nothing else.
 */

describe('deriveMode', function () {
  it('should give the writer the turn when focus was last in the editor', function () {
    expect(deriveMode('editor', undefined)).toBe('writer');
  });

  it('should give the agent the turn when focus was last in the chat', function () {
    expect(deriveMode('chat', undefined)).toBe('agent');
  });

  // The mode that asks first is the one you should get by default.
  it('should give the writer the turn when focus has been nowhere yet', function () {
    expect(deriveMode(undefined, undefined)).toBe('writer');
  });
});

describe('the pin', function () {
  // A writer reading the preview still wants the agent working, and nothing
  // about where focus last was can say so.
  it('should give the agent the turn when pinned there with focus in the editor', function () {
    expect(deriveMode('editor', 'agent')).toBe('agent');
  });

  it('should give the writer the turn when pinned there with focus in the chat', function () {
    expect(deriveMode('chat', 'writer')).toBe('writer');
  });

  it('should override the default when focus has been nowhere yet', function () {
    expect(deriveMode(undefined, 'agent')).toBe('agent');
  });

  // Three states in one control: an override the writer cannot get back out of
  // would be a worse control than none.
  it('should cycle unpinned to the writer to the agent and back to unpinned', function () {
    const seen: TurnPin[] = [];
    const first = cyclePin(undefined);
    const second = cyclePin(first);
    const third = cyclePin(second);
    seen.push(first, second, third);

    expect(seen).toEqual(['writer', 'agent', undefined]);
  });
});

describe('indicatorFor', function () {
  it('should show whose turn it is while nothing is being written', function () {
    expect(indicatorFor('writer', false)).toBe('writer');
    expect(indicatorFor('agent', false)).toBe('agent');
  });

  it('should show the landing state over either turn while a write is in flight', function () {
    expect(indicatorFor('writer', true)).toBe('landing');
    expect(indicatorFor('agent', true)).toBe('landing');
  });
});

describe('indicatorLabel', function () {
  it('should say who may edit next in each of the three states', function () {
    expect(indicatorLabel('writer', false)).toContain('asks before');
    expect(indicatorLabel('agent', false)).toContain('without asking');
    expect(indicatorLabel('landing', false)).toContain('writing the document');
  });

  // Otherwise an overridden mode reads exactly like a derived one, and the pin
  // is invisible to anyone who cannot see the glyph.
  it('should say when a pin rather than the focus rule put it there', function () {
    expect(indicatorLabel('agent', true)).toContain('pinned');
    expect(indicatorLabel('agent', false)).not.toContain('pinned');
  });
});

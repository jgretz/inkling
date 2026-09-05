import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import {DEFAULT_LAYOUT} from '../src/lib/settings.ts';
import {indicatorLabel, type TurnIndicator} from '../src/lib/turn.ts';
import {TitleBar} from '../src/components/shell/TitleBar.tsx';

autoCleanup();

/**
 * The turn indicator, which is the only place whose turn it is is visible.
 *
 * The rest of the bar is layout toggles and a save label, and a test over those
 * would pin markup rather than behaviour. What is behaviour is that the three
 * states are distinguishable, that the pin shows, and that clicking cycles it.
 */

type BarProps = {
  turn?: TurnIndicator;
  pinned?: boolean;
  onPin?: () => void;
};

function noop() {}

function bar({turn = 'writer', pinned = false, onPin = noop}: BarProps = {}) {
  return render(
    <TitleBar
      title="The piece"
      subtitle="vault"
      save={undefined}
      layout={DEFAULT_LAYOUT}
      onToggle={noop}
      turn={turn}
      pinned={pinned}
      onPin={onPin}
    />,
  );
}

describe('the turn indicator', function () {
  it('should name the writers turn when it is theirs', function () {
    const view = bar({turn: 'writer'});

    expect(view.getByLabelText(indicatorLabel('writer', false))).toBeDefined();
  });

  it('should name the agents turn when it is its own', function () {
    const view = bar({turn: 'agent'});

    expect(view.getByLabelText(indicatorLabel('agent', false))).toBeDefined();
  });

  // The third state is transient and is about a write actually in flight, so it
  // must be distinguishable from the resting agent's turn rather than equal to it.
  it('should show a state of its own while an edit is landing', function () {
    const view = bar({turn: 'landing'});

    expect(view.getByLabelText(indicatorLabel('landing', false))).toBeDefined();
    expect(view.queryByLabelText(indicatorLabel('agent', false))).toBeNull();
  });

  it('should say when a pin rather than the focus rule decided it', function () {
    const view = bar({turn: 'agent', pinned: true});

    expect(view.getByLabelText(indicatorLabel('agent', true))).toBeDefined();
  });

  it('should ask for the next pin when it is clicked', function () {
    let asked = 0;
    const view = bar({
      onPin() {
        asked += 1;
      },
    });

    fireEvent.click(view.getByLabelText(indicatorLabel('writer', false)));

    expect(asked).toBe(1);
  });
});

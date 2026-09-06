import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import {DEFAULT_LAYOUT} from '../src/lib/settings.ts';
import {indicatorLabel, type TurnIndicator} from '../src/lib/turn.ts';
import {TitleBar} from '../src/components/shell/TitleBar.tsx';

autoCleanup();

/**
 * The two things in the bar that are behaviour rather than markup: the turn
 * indicator, which is the only place whose turn it is is visible, and the
 * document menu, which is the writer's way out.
 *
 * The rest is layout toggles and a save label, and a test over those would pin
 * markup. What is behaviour here is that the three turn states are
 * distinguishable, that the pin shows, that clicking cycles it, and that the
 * menu is mounted and told whether there is a document to give anyone.
 */

type BarProps = {
  turn?: TurnIndicator;
  pinned?: boolean;
  onPin?: () => void;
  docOpen?: boolean;
};

function noop() {}

function bar({turn = 'writer', pinned = false, onPin = noop, docOpen = true}: BarProps = {}) {
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
      onExport={noop}
      onCopy={noop}
      onSnapshot={noop}
      onOpenRevisions={noop}
      docOpen={docOpen}
    />,
  );
}

describe('the turn indicator', function () {
  // The visible word as well as the accessible name. The name is composed by
  // `indicatorLabel`, which its own suite pins, so asserting on it alone would
  // leave a bar that rendered no word at all passing.
  it('should name the writers turn when it is theirs', function () {
    const view = bar({turn: 'writer'});

    expect(view.getByLabelText(indicatorLabel('writer', false))).toBeDefined();
    expect(view.getByText('You')).toBeDefined();
  });

  it('should name the agents turn when it is its own', function () {
    const view = bar({turn: 'agent'});

    expect(view.getByLabelText(indicatorLabel('agent', false))).toBeDefined();
    expect(view.getByText('Agent')).toBeDefined();
  });

  // The third state is transient and is about a write actually in flight, so it
  // must be distinguishable from the resting agent's turn rather than equal to it.
  it('should show a state of its own while an edit is landing', function () {
    const view = bar({turn: 'landing'});

    expect(view.getByLabelText(indicatorLabel('landing', false))).toBeDefined();
    expect(view.getByText('Writing…')).toBeDefined();
    expect(view.queryByLabelText(indicatorLabel('agent', false))).toBeNull();
    expect(view.queryByText('Agent')).toBeNull();
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

/**
 * The document menu has its own suite, which renders it directly. This is the
 * other half: that the bar mounts it at all, and hands it whether there is a
 * document. Without these, the control could be taken out of the bar entirely
 * and every suite would still pass.
 */
describe('the document menu in the bar', function () {
  it('should offer the ways out when a document is open', function () {
    const view = bar({docOpen: true});

    fireEvent.click(view.getByLabelText('Document actions'));

    expect(view.getByText('Export…')).toBeDefined();
    expect(view.getByText('Copy as rich text')).toBeDefined();
  });

  it('should refuse with no document open', function () {
    const view = bar({docOpen: false});

    fireEvent.click(view.getByLabelText('Document actions'));

    expect(view.queryByRole('menu')).toBeNull();
  });
});

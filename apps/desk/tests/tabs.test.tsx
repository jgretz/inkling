import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useId, useState} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {Tabs, panelId, tabId, type TabEntry} from '../src/components/shell/Tabs.tsx';

autoCleanup();

type Which = 'first' | 'second';

const PAIR: readonly TabEntry<Which>[] = [
  {id: 'first', label: 'Conversation'},
  {id: 'second', label: 'Context'},
];

/** A caller of the set, holding the selection the way `ChatPanel` does. */
function Harness({tabs = PAIR}: {tabs?: readonly TabEntry<Which>[]}) {
  const [selected, setSelected] = useState<Which>('first');
  const ids = useId();

  return (
    <div>
      <Tabs
        tabs={tabs}
        selected={selected}
        onSelect={setSelected}
        label="Agent panel"
        idPrefix={ids}
      />
      <div id={panelId(ids, selected)} role="tabpanel" aria-labelledby={tabId(ids, selected)} />
    </div>
  );
}

function tabs(props: {tabs?: readonly TabEntry<Which>[]} = {}) {
  return render(<Harness {...props} />);
}

function at(view: ReturnType<typeof tabs>, index: number): HTMLElement {
  const found = view.getAllByRole('tab')[index];
  if (found === undefined) throw new Error(`no tab at ${index}`);
  return found;
}

describe('Tabs', function () {
  it('should open on the tab its caller says is selected', function () {
    const view = tabs();

    expect(at(view, 0).getAttribute('aria-selected')).toBe('true');
    expect(at(view, 1).getAttribute('aria-selected')).toBe('false');
  });

  it('should point the selected tab at the panel it controls', function () {
    const view = tabs();

    const panel = view.getByRole('tabpanel');

    expect(at(view, 0).getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
    expect(panel.getAttribute('aria-labelledby')).toBe(at(view, 0).getAttribute('id'));
  });

  // A caller that mounts one panel at a time has nothing for the other tabs to
  // point at, and naming an element that is not there promises a screen reader
  // something it cannot go and read.
  it('should claim no panel for a tab that is not selected', function () {
    const view = tabs();

    expect(at(view, 1).getAttribute('aria-controls')).toBeNull();
  });

  it('should select and focus the next tab on ArrowRight', function () {
    const view = tabs();

    fireEvent.keyDown(at(view, 0), {key: 'ArrowRight'});

    expect(at(view, 1).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(at(view, 1));
  });

  // Only the selected tab is in the page's tab order: tabbing through the panel
  // passes the whole set once, and the arrows move within it.
  it('should keep only the selected tab in the tab order', function () {
    const view = tabs();
    expect(at(view, 0).getAttribute('tabindex')).toBe('0');
    expect(at(view, 1).getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(at(view, 0), {key: 'ArrowRight'});

    expect(at(view, 1).getAttribute('tabindex')).toBe('0');
    expect(at(view, 0).getAttribute('tabindex')).toBe('-1');
  });

  it('should move back on ArrowLeft', function () {
    const view = tabs();
    fireEvent.keyDown(at(view, 0), {key: 'ArrowRight'});

    fireEvent.keyDown(at(view, 1), {key: 'ArrowLeft'});

    expect(at(view, 0).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(at(view, 0));
  });

  /** Two tabs make either arrow the same gesture, so both ends have to wrap. */
  it('should wrap from the last tab round to the first', function () {
    const view = tabs();
    fireEvent.keyDown(at(view, 0), {key: 'ArrowRight'});

    fireEvent.keyDown(at(view, 1), {key: 'ArrowRight'});

    expect(at(view, 0).getAttribute('aria-selected')).toBe('true');
  });

  it('should wrap from the first tab round to the last', function () {
    const view = tabs();

    fireEvent.keyDown(at(view, 0), {key: 'ArrowLeft'});

    expect(at(view, 1).getAttribute('aria-selected')).toBe('true');
  });

  it('should leave the selection alone on a key it does not handle', function () {
    const view = tabs();

    fireEvent.keyDown(at(view, 0), {key: 'ArrowDown'});

    expect(at(view, 0).getAttribute('aria-selected')).toBe('true');
  });

  it('should select the tab that is clicked', function () {
    const view = tabs();

    fireEvent.click(at(view, 1));

    expect(at(view, 1).getAttribute('aria-selected')).toBe('true');
  });

  // A dot is not something a screen reader can be told about, so the note has
  // to be in the name as well as on screen.
  it('should say a note out loud in the tabs accessible name', function () {
    const view = tabs({
      tabs: [
        {id: 'first', label: 'Conversation', note: 'new reply'},
        {id: 'second', label: 'Context'},
      ],
    });

    expect(view.getByLabelText('Conversation, new reply')).toBeDefined();
    expect(at(view, 1).getAttribute('aria-label')).toBeNull();
  });

  // The sighted half of the same note. It is the only thing on the tab a reader
  // looking at the panel can see, so nothing else being asserted would leave a
  // note that announces itself and shows nothing.
  it('should draw the note as a dot on the tab it belongs to and no other', function () {
    const view = tabs({
      tabs: [
        {id: 'first', label: 'Conversation', note: 'new reply'},
        {id: 'second', label: 'Context'},
      ],
    });

    expect(at(view, 0).querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(at(view, 1).querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('should draw no dot on a tab with nothing to report', function () {
    const view = tabs();

    expect(view.getByRole('tablist').querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('should name the set for a reader arriving in it', function () {
    const view = tabs();

    expect(view.getByRole('tablist').getAttribute('aria-label')).toBe('Agent panel');
  });
});

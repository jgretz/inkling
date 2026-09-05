import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useState} from 'react';
import {fireEvent, render} from '@testing-library/react';
import type {DocPath} from '@inkling/vault';
import {emptyContext, type AgentTransport, type Message} from '../src/lib/agent.ts';
import type {Conversation} from '../src/lib/conversations.ts';
import {ChatPanel} from '../src/components/chat/ChatPanel.tsx';

autoCleanup();

function noop() {}

/**
 * A transport that answers nothing. Every case here is about what the writer
 * sees when they move between conversations, and none of them sends a turn.
 */
const SILENT: AgentTransport = {
  name: 'toryo',
  async *send() {
    return;
  },
};

function conversation(id: number, title: string): Conversation {
  return {
    id,
    docPath: 'drafts/a.md' as DocPath,
    title,
    sessionId: null,
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ALL = [conversation(1, 'On endings'), conversation(2, 'On openings')];

/** What each conversation has already said, as the store would return it. */
const STORED: Record<number, Message[]> = {
  1: [
    {id: 't1w', role: 'writer', text: 'Tighten the ending', at: '2026-01-01T00:00:00.000Z'},
    {id: 't1a', role: 'agent', text: 'Cut the last line.', at: '2026-01-01T00:00:00.000Z'},
  ],
  2: [
    {id: 't2w', role: 'writer', text: 'And the opening?', at: '2026-01-02T00:00:00.000Z'},
    {id: 't2a', role: 'agent', text: 'Start on the verb.', at: '2026-01-02T00:00:00.000Z'},
  ],
};

/**
 * What `App.tsx` does around the panel: it holds which conversation is active,
 * hands over that one's stored turns, and keys the panel on the id so switching
 * remounts rather than merging one conversation's replies into another's.
 */
function Harness({started, onCreate = noop}: {started: number; onCreate?: () => void}) {
  const [activeId, setActiveId] = useState(started);

  return (
    <ChatPanel
      key={activeId}
      transport={SILENT}
      context={emptyContext()}
      references={{
        docs: [],
        group: undefined,
        canAttach: false,
        onAttach: noop,
        onDetach: noop,
        onSuppress: noop,
        onRestore: noop,
      }}
      initial={STORED[activeId] ?? []}
      conversations={{all: ALL, activeId, onSelect: setActiveId, onCreate}}
    />
  );
}

function panel(props: {started?: number; onCreate?: () => void} = {}) {
  return render(<Harness started={props.started ?? 1} onCreate={props.onCreate} />);
}

describe('the conversation switcher', function () {
  it('should list every conversation about the open document', function () {
    const view = panel();

    const options = view.getAllByRole('option').map(function (option) {
      return option.textContent;
    });

    expect(options).toEqual(['On endings', 'On openings', 'New conversation']);
  });

  it('should show the active conversation as the one selected', function () {
    const view = panel({started: 2});

    expect((view.getByLabelText('Conversation') as HTMLSelectElement).value).toBe('2');
  });

  // The hook test cannot close this: the switcher is what a writer sees, and a
  // panel that kept its own messages across a switch would show one
  // conversation's replies under another's name.
  it('should replace the visible messages when the second conversation is picked', function () {
    const view = panel();
    expect(view.getByText('Cut the last line.')).toBeDefined();

    fireEvent.change(view.getByLabelText('Conversation'), {target: {value: '2'}});

    expect(view.getByText('Start on the verb.')).toBeDefined();
    expect(view.queryByText('Cut the last line.')).toBeNull();
  });

  it('should ask for a new conversation rather than select one when that entry is picked', function () {
    let asked = 0;
    const view = panel({
      onCreate() {
        asked += 1;
      },
    });

    fireEvent.change(view.getByLabelText('Conversation'), {target: {value: 'new'}});

    expect(asked).toBe(1);
    // Still on the conversation it was on: the new one arrives through the
    // store, not by the panel guessing an id.
    expect(view.getByText('Cut the last line.')).toBeDefined();
  });
});

describe('the message list', function () {
  it('should open with the stored turns rather than empty', function () {
    const view = panel();

    expect(view.getByText('Tighten the ending')).toBeDefined();
    expect(
      view.queryByText('Ask for a rewrite, an outline, or a second opinion.', {exact: false}),
    ).toBeNull();
  });

  it('should invite a first message when the conversation has said nothing', function () {
    const view = render(<Harness started={3} />);

    expect(
      view.getByText('Ask for a rewrite, an outline, or a second opinion.', {exact: false}),
    ).toBeDefined();
  });
});

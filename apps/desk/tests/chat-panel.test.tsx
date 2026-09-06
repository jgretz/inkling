import {autoCleanup, drainReactScheduler} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useState} from 'react';
import {act, fireEvent, render} from '@testing-library/react';
import type {DocPath} from '@inkling/vault';
import {
  emptyContext,
  type AgentContext,
  type AgentTransport,
  type Message,
  type Turn,
} from '../src/lib/agent.ts';
import type {Conversation} from '../src/lib/conversations.ts';
import {pointerAt, type Pointer} from '../src/lib/pointer.ts';
import type {ContextReference} from '../src/lib/references.ts';
import type {Edit} from '../src/lib/reply.ts';
import type {TurnMode} from '../src/lib/turn.ts';
import {ChatPanel} from '../src/components/chat/ChatPanel.tsx';

autoCleanup();

function noop() {}

/** A write that resolves having done nothing, for the controls this suite ignores. */
function noWrite(): Promise<void> {
  return Promise.resolve();
}

function noFlush(): Promise<void> {
  return Promise.resolve();
}

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

const ENDINGS = conversation(1, 'On endings');
const OPENINGS = conversation(2, 'On openings');
const ALL = [ENDINGS, OPENINGS];

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
type HarnessProps = {
  started: number;
  onCreate?: () => void;
  onDelete?: () => void;
  /** The document's conversations, so a document down to its last one is testable. */
  all?: readonly Conversation[];
  transport?: AgentTransport;
  mode?: TurnMode;
  /** The document the turn carries, so a swap mid-turn is testable. */
  context?: AgentContext;
  onFlush?: () => Promise<void>;
  onAccept?: (edit: Edit) => void;
  onLand?: (edit: Edit, path: DocPath | undefined) => void;
  onPoint?: (pointer: Pointer) => void;
  onFocus?: () => void;
};

function Harness({
  started,
  onCreate = noop,
  onDelete = noop,
  all = ALL,
  transport = SILENT,
  mode = 'writer',
  context = emptyContext(),
  onFlush = noFlush,
  onAccept = noop,
  onLand = noop,
  onPoint = noop,
  onFocus = noop,
}: HarnessProps) {
  const [activeId, setActiveId] = useState(started);

  return (
    <ChatPanel
      key={activeId}
      transport={transport}
      context={context}
      references={{
        docs: [],
        group: undefined,
        canAttach: false,
        onAttach: noop,
        onAttachMany: noWrite,
        onDetach: noop,
        onSuppress: noop,
        onRestore: noop,
      }}
      initial={STORED[activeId] ?? []}
      conversations={{all, activeId, onSelect: setActiveId, onCreate, onDelete}}
      mode={mode}
      onFlush={onFlush}
      onAccept={onAccept}
      onLand={onLand}
      onPoint={onPoint}
      onFocus={onFocus}
      composerHeight={96}
      onResizeComposer={noop}
    />
  );
}

function harness(props: Partial<HarnessProps> = {}) {
  return <Harness {...props} started={props.started ?? 3} />;
}

function panel(props: Partial<HarnessProps> = {}) {
  return render(<Harness {...props} started={props.started ?? 1} />);
}

const EDIT: Edit = {quote: 'rather good', replacement: 'good'};

/** A context carrying one open document, which is all the landing path needs. */
function about(path: DocPath): AgentContext {
  return {...emptyContext(), doc: {path, title: 'A draft', source: 'The ending is rather good.'}};
}

/** Types a message and presses send, letting the turn run as far as it can. */
async function ask(view: ReturnType<typeof render>, text = 'Tighten this'): Promise<void> {
  await act(async function () {
    fireEvent.change(view.getByLabelText('Message the agent'), {target: {value: text}});
  });
  await act(async function () {
    fireEvent.click(view.getByLabelText('Send message'));
    await drainReactScheduler();
  });
}

/** A promise the test decides when to settle, for pausing a turn mid-stream. */
function gate(): {promise: Promise<void>; open: () => void} {
  let open = function () {};
  const promise = new Promise<void>(function (resolve) {
    open = resolve;
  });
  return {promise, open};
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

  it('should ask to delete the active conversation', function () {
    let asked = 0;
    const view = panel({
      onDelete() {
        asked += 1;
      },
    });

    fireEvent.click(view.getByLabelText('Delete conversation'));

    expect(asked).toBe(1);
  });

  // Deleting it would leave the writer typing into nothing: the panel needs a
  // conversation to put the next turn in.
  it('should refuse to delete the last conversation about a document', function () {
    let asked = 0;
    const view = panel({
      all: [ENDINGS],
      onDelete() {
        asked += 1;
      },
    });

    const button = view.getByLabelText('Delete conversation') as HTMLButtonElement;
    fireEvent.click(button);

    expect(button.disabled).toBe(true);
    expect(asked).toBe(0);
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

/**
 * A transport that records the turns it was handed and answers each one
 * according to the authorization that turn carried, the way the real one does.
 *
 * `pause` holds the turn open between the prose and the reply, which is the
 * window a writer's focus can move in.
 */
function scripted(options: {order?: string[]; pause?: Promise<void>} = {}) {
  const sent: Turn[] = [];
  const transport: AgentTransport = {
    name: 'test',
    async *send(turn) {
      sent.push(turn);
      options.order?.push('send');
      yield {kind: 'text', text: 'Tightened it.'};
      if (options.pause !== undefined) await options.pause;
      yield turn.authorized
        ? {kind: 'reply', reply: {kind: 'made', text: 'Tightened it.', edit: EDIT}}
        : {kind: 'reply', reply: {kind: 'proposed', text: 'Tightened it.', edit: EDIT}};
    },
  };
  return {transport, sent};
}

describe('whose turn a send is', function () {
  it('should send an unauthorized turn while the turn is the writers', async function () {
    const {transport, sent} = scripted();
    const view = panel({started: 3, transport, mode: 'writer'});

    await ask(view);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorized).toBe(false);
  });

  it('should send an authorized turn while the turn is the agents', async function () {
    const {transport, sent} = scripted();
    const view = panel({started: 3, transport, mode: 'agent'});

    await ask(view);

    expect(sent[0]?.authorized).toBe(true);
  });

  // On call order rather than on a timer: the guarantee is that the file the
  // agent may read matches the buffer, and a sleep would only ever suggest it.
  //
  // The flush records itself when it RESOLVES, not when it is called, so this
  // pins the await rather than the call. A send that fired the flush and did
  // not wait for it would order the other way round.
  it('should await the flush before the authorized turn leaves', async function () {
    const order: string[] = [];
    const {transport} = scripted({order});
    const view = panel({
      started: 3,
      transport,
      mode: 'agent',
      onFlush() {
        return Promise.resolve().then(function () {
          order.push('flush');
        });
      },
    });

    await ask(view);

    expect(order).toEqual(['flush', 'send']);
  });

  // Nothing to flush for: the writer's turn writes nothing and the agent is not
  // being invited to read the file.
  it('should not flush for a turn that is the writers', async function () {
    const order: string[] = [];
    const {transport} = scripted({order});
    const view = panel({
      started: 3,
      transport,
      mode: 'writer',
      onFlush() {
        order.push('flush');
        return Promise.resolve();
      },
    });

    await ask(view);

    expect(order).toEqual(['send']);
  });

  // Authorization is captured at send time. A writer who fires off a rewrite
  // and then clicks into the editor while it thinks has not revoked it.
  it('should still land the edit when focus moved to the editor mid-turn', async function () {
    const held = gate();
    const {transport, sent} = scripted({pause: held.promise});
    const landed: Edit[] = [];
    const props: Partial<HarnessProps> = {
      started: 3,
      transport,
      mode: 'agent',
      onLand(edit: Edit) {
        landed.push(edit);
      },
    };
    const view = render(harness(props));

    await ask(view);
    expect(sent[0]?.authorized).toBe(true);

    // The writer clicks back into the document while the reply is streaming.
    await act(async function () {
      view.rerender(harness({...props, mode: 'writer'}));
    });
    await act(async function () {
      held.open();
      await drainReactScheduler();
    });

    expect(landed).toEqual([EDIT]);
  });

  // The document is captured with the authorization, for the same reason. A
  // writer who opened another document mid-turn must not have the agent's edit
  // offered against a file the turn never read: two documents made from one
  // template share passages, so a quote can match in the wrong one.
  it('should report the document the turn carried, not the one open when it lands', async function () {
    const held = gate();
    const {transport} = scripted({pause: held.promise});
    const targets: Array<DocPath | undefined> = [];
    const props: Partial<HarnessProps> = {
      started: 3,
      transport,
      mode: 'agent',
      context: about('asked-about.md' as DocPath),
      onLand(_edit: Edit, path: DocPath | undefined) {
        targets.push(path);
      },
    };
    const view = render(harness(props));

    await ask(view);

    await act(async function () {
      view.rerender(harness({...props, context: about('opened-since.md' as DocPath)}));
    });
    await act(async function () {
      held.open();
      await drainReactScheduler();
    });

    expect(targets).toEqual(['asked-about.md' as DocPath]);
  });
});

describe('a proposed edit', function () {
  it('should offer the replacement and the passage it replaces', async function () {
    const {transport} = scripted();
    const view = panel({started: 3, transport, mode: 'writer'});

    await ask(view);

    expect(view.getByText('rather good')).toBeDefined();
    expect(view.getByText('good')).toBeDefined();
  });

  it('should report the edit to the caller when it is accepted', async function () {
    const accepted: Edit[] = [];
    const {transport} = scripted();
    const view = panel({
      started: 3,
      transport,
      mode: 'writer',
      onAccept(edit: Edit) {
        accepted.push(edit);
      },
    });
    await ask(view);

    await act(async function () {
      fireEvent.click(view.getByText('Accept'));
    });

    expect(accepted).toEqual([EDIT]);
    expect(view.queryByText('Accept')).toBeNull();
  });

  it('should report nothing and leave the conversation alone when it is rejected', async function () {
    const accepted: Edit[] = [];
    const {transport} = scripted();
    const view = panel({
      started: 3,
      transport,
      mode: 'writer',
      onAccept(edit: Edit) {
        accepted.push(edit);
      },
    });
    await ask(view);

    await act(async function () {
      fireEvent.click(view.getByText('Reject'));
    });

    expect(accepted).toEqual([]);
    expect(view.queryByText('Accept')).toBeNull();
    // What was said stays said. Rejecting an edit is not deleting a reply.
    expect(view.getByText('Tighten this')).toBeDefined();
    expect(view.getByText('Tightened it.')).toBeDefined();
  });

  it('should not land anything the writer only accepted into the buffer', async function () {
    const landed: Edit[] = [];
    const {transport} = scripted();
    const view = panel({
      started: 3,
      transport,
      mode: 'writer',
      onLand(edit: Edit) {
        landed.push(edit);
      },
    });
    await ask(view);

    await act(async function () {
      fireEvent.click(view.getByText('Accept'));
    });

    expect(landed).toEqual([]);
  });
});

describe('a refused reply', function () {
  /** What the transport yields when the validator would not read the block. */
  const REFUSING: AgentTransport = {
    name: 'test',
    async *send() {
      yield {kind: 'text', text: 'Tightened it.'};
      yield {
        kind: 'reply',
        reply: {
          kind: 'refused',
          text: 'Tightened it.',
          reason: 'its edit block was not readable as JSON',
        },
      };
    },
  };

  it('should show the reason and offer nothing to accept', async function () {
    const accepted: Edit[] = [];
    const view = panel({
      started: 3,
      transport: REFUSING,
      mode: 'agent',
      onAccept(edit: Edit) {
        accepted.push(edit);
      },
    });

    await ask(view);

    expect(view.getByText('not readable as JSON', {exact: false})).toBeDefined();
    expect(view.queryByText('Accept')).toBeNull();
    expect(accepted).toEqual([]);
  });

  it('should land nothing on a turn whose reply it refused', async function () {
    const landed: Edit[] = [];
    const view = panel({
      started: 3,
      transport: REFUSING,
      mode: 'agent',
      onLand(edit: Edit) {
        landed.push(edit);
      },
    });

    await ask(view);

    expect(landed).toEqual([]);
  });
});

describe('a reply that points', function () {
  const DRAFT = 'The ending is rather good.';

  /** A transport whose reply points at `quote` and nothing else. */
  function pointing(quote: string): AgentTransport {
    return {
      name: 'test',
      async *send() {
        yield {kind: 'text', text: 'That is the strong half.'};
        yield {kind: 'reply', reply: {kind: 'point', text: 'That is the strong half.', quote}};
      },
    };
  }

  function about(source: string): AgentContext {
    return {
      ...emptyContext(),
      doc: {path: 'drafts/a.md' as DocPath, title: 'A draft', source},
    };
  }

  it('should show the passage the reply named, in its own words', async function () {
    const view = panel({started: 3, transport: pointing('rather good'), context: about(DRAFT)});

    await ask(view);

    expect(view.getByLabelText(/^Show the passage the agent pointed at/).textContent).toContain(
      'rather good',
    );
  });

  it('should hand the pointer to the caller when the reference is clicked', async function () {
    const shown: Pointer[] = [];
    const view = panel({
      started: 3,
      transport: pointing('rather good'),
      context: about(DRAFT),
      onPoint(pointer: Pointer) {
        shown.push(pointer);
      },
    });
    await ask(view);

    await act(async function () {
      fireEvent.click(view.getByLabelText(/^Show the passage the agent pointed at/));
    });

    expect(shown).toHaveLength(1);
    expect(shown[0]?.quote).toBe('rather good');
    // An anchor, not a range: the writer goes on editing, and the offsets it
    // was pointed at with stop being true the moment they do.
    expect(shown[0]?.anchor.hint).toBe(DRAFT.indexOf('rather good'));
  });

  // Against the document the turn carried, not whatever is open now. A quote the
  // snapshot never held is a reply inkling cannot act on.
  it('should refuse a quote the turns own document does not hold', async function () {
    const view = panel({
      started: 3,
      transport: pointing('the closing line'),
      context: about(DRAFT),
    });

    await ask(view);

    // One notice, reading as one sentence: the miss finishes the clause the
    // refusal opened rather than starting a capitalised one of its own.
    expect(
      view.getByText(
        'Inkling did not act on this reply: the passage it quoted is not in the document the turn carried',
        {exact: false},
      ),
    ).toBeDefined();
    expect(view.queryByLabelText(/^Show the passage the agent pointed at/)).toBeNull();
  });

  it('should refuse a quote the document holds twice', async function () {
    const view = panel({
      started: 3,
      transport: pointing('One.'),
      context: about('One. Two. One.'),
    });

    await ask(view);

    expect(view.getByText('appears more than once', {exact: false})).toBeDefined();
    expect(view.queryByLabelText(/^Show the passage the agent pointed at/)).toBeNull();
  });

  it('should offer nothing to accept, because a point changes nothing', async function () {
    const view = panel({started: 3, transport: pointing('rather good'), context: about(DRAFT)});

    await ask(view);

    expect(view.queryByText('Accept')).toBeNull();
  });
});

describe('the writers own selection', function () {
  const DRAFT = 'The ending is rather good.';

  function withSelection(): AgentContext {
    return {
      ...emptyContext(),
      doc: {path: 'drafts/a.md' as DocPath, title: 'A draft', source: DRAFT},
      selection: pointerAt(DRAFT, 14, 25),
    };
  }

  it('should show what the writer had highlighted under their own message', async function () {
    const view = panel({started: 3, context: withSelection()});

    await ask(view);

    expect(view.getByLabelText(/^Show the passage you selected/).textContent).toContain(
      'rather good',
    );
  });

  it('should hand that pointer to the caller when it is clicked', async function () {
    const shown: Pointer[] = [];
    const view = panel({
      started: 3,
      context: withSelection(),
      onPoint(pointer: Pointer) {
        shown.push(pointer);
      },
    });
    await ask(view);

    await act(async function () {
      fireEvent.click(view.getByLabelText(/^Show the passage you selected/));
    });

    expect(shown).toHaveLength(1);
    expect(shown[0]?.quote).toBe('rather good');
  });

  it('should show nothing under a message sent with nothing selected', async function () {
    const view = panel({started: 3, context: emptyContext()});

    await ask(view);

    expect(view.queryByLabelText(/^Show the passage you selected/)).toBeNull();
  });
});

describe('the panel tabs', function () {
  /** An attached reference, as `assembleReferences` hands one over. */
  const STYLE: ContextReference = {
    id: 1,
    kind: 'doc',
    title: 'The style guide',
    source: 'x'.repeat(120),
    target: 'notes/style.md',
    origin: {level: 'document'},
    missing: false,
    suppressedBy: undefined,
    tokens: 30,
  };

  /** 50 tokens of document and 30 of reference, so the total is a round 80. */
  function carrying(): AgentContext {
    return {
      doc: {path: 'drafts/a.md' as DocPath, title: 'A draft', source: 'p'.repeat(200)},
      selection: undefined,
      references: [STYLE],
    };
  }

  function tabAt(view: ReturnType<typeof render>, index: number): HTMLElement {
    const found = view.getAllByRole('tab')[index];
    if (found === undefined) throw new Error(`no tab at ${index}`);
    return found;
  }

  function conversationTab(view: ReturnType<typeof render>): HTMLElement {
    return tabAt(view, 0);
  }

  function contextTab(view: ReturnType<typeof render>): HTMLElement {
    return tabAt(view, 1);
  }

  function summary(view: ReturnType<typeof render>): HTMLElement {
    return view.getByLabelText(/^What the agent can see/);
  }

  // The switcher directly above is already called "Conversation", and two
  // controls with one name in a panel this small is a panel a screen reader
  // cannot describe.
  it('should not name a tab what the switcher above it is called', function () {
    const view = panel({context: carrying()});

    const names = view.getAllByRole('tab').map(function (entry) {
      return entry.getAttribute('aria-label') ?? entry.textContent;
    });

    expect(names).toEqual(['Transcript', 'Context']);
    expect(view.getByLabelText('Conversation').tagName).toBe('SELECT');
  });

  it('should open on the conversation', function () {
    const view = panel({context: carrying()});

    expect(conversationTab(view).getAttribute('aria-selected')).toBe('true');
    expect(view.getByText('Cut the last line.')).toBeDefined();
  });

  // The promise is that the writer is told, not that they could have looked:
  // the accounting is on screen while they compose, on whichever tab they are.
  it('should report the same count and total on both tabs', function () {
    const view = panel({context: carrying()});
    expect(summary(view).textContent).toBe('1 reference, ~80 tokens');

    fireEvent.click(contextTab(view));

    expect(summary(view).textContent).toBe('1 reference, ~80 tokens');
    expect(summary(view).getAttribute('aria-label')).toBe(
      'What the agent can see: 1 reference, about 80 tokens. Show the context tab.',
    );
  });

  it('should count a context carrying no references at all', function () {
    const view = panel({context: emptyContext()});

    expect(summary(view).textContent).toBe('0 references, ~0 tokens');
  });

  it('should open the context tab from the summary line', function () {
    const view = panel({context: carrying()});

    fireEvent.click(summary(view));

    expect(contextTab(view).getAttribute('aria-selected')).toBe('true');
    expect(view.getByText('The style guide')).toBeDefined();
  });

  it('should show what the turn carries on the context tab', function () {
    const view = panel({context: carrying()});
    expect(view.queryByText('The style guide')).toBeNull();

    fireEvent.click(contextTab(view));

    expect(view.getByText('The style guide')).toBeDefined();
    expect(view.getByText('A draft')).toBeDefined();
    // One panel is mounted at a time: a transcript kept in a hidden subtree is
    // a transcript still scrolling itself where nobody can see it.
    expect(view.queryByText('Cut the last line.')).toBeNull();
  });

  // The invitation used to say the context was listed below, which was true
  // when it was. A writer told to look below now finds the composer there.
  it('should point a first-time writer at the tab the accounting moved to', function () {
    const view = panel({started: 3, context: carrying()});

    expect(
      view.getByText('What the agent can see is on the Context tab.', {exact: false}),
    ).toBeDefined();
  });

  it('should keep the composer and its handle on both tabs', function () {
    const view = panel({context: carrying()});
    expect(view.getByLabelText('Message the agent')).toBeDefined();
    expect(view.getByLabelText('Resize the message box')).toBeDefined();

    fireEvent.click(contextTab(view));

    expect(view.getByLabelText('Message the agent')).toBeDefined();
    expect(view.getByLabelText('Resize the message box')).toBeDefined();
  });

  it('should bring the transcript back when the conversation is selected again', function () {
    const view = panel({context: carrying()});
    fireEvent.click(contextTab(view));

    fireEvent.click(conversationTab(view));

    expect(view.getByText('Cut the last line.')).toBeDefined();
  });

  // Announced, never acted on. A writer reading what the turn will carry does
  // not have the panel pulled out from under them because the agent replied.
  it('should say a reply arrived behind the context tab without switching to it', async function () {
    const held = gate();
    const {transport} = scripted({pause: held.promise});
    const view = panel({started: 3, transport, mode: 'writer', context: carrying()});
    await ask(view);

    fireEvent.click(contextTab(view));
    await act(async function () {
      held.open();
      await drainReactScheduler();
    });

    expect(conversationTab(view).getAttribute('aria-label')).toBe('Transcript, new reply');
    expect(conversationTab(view).getAttribute('aria-selected')).toBe('false');
    expect(contextTab(view).getAttribute('aria-selected')).toBe('true');
  });

  it('should stop saying so once the conversation has been looked at', async function () {
    const held = gate();
    const {transport} = scripted({pause: held.promise});
    const view = panel({started: 3, transport, mode: 'writer', context: carrying()});
    await ask(view);
    fireEvent.click(contextTab(view));
    await act(async function () {
      held.open();
      await drainReactScheduler();
    });

    fireEvent.click(conversationTab(view));

    expect(conversationTab(view).getAttribute('aria-label')).toBeNull();
  });

  it('should say nothing about a reply that arrived in plain sight', async function () {
    const {transport} = scripted();
    const view = panel({started: 3, transport, mode: 'writer', context: carrying()});

    await ask(view);

    expect(conversationTab(view).getAttribute('aria-label')).toBeNull();
  });

  // A failure is something that arrived too, and it is the one a writer looking
  // elsewhere most needs telling about.
  it('should say a failed turn arrived behind the context tab', async function () {
    const held = gate();
    const failing: AgentTransport = {
      name: 'test',
      async *send() {
        await held.promise;
        throw new Error('the daemon refused');
      },
    };
    const view = panel({started: 3, transport: failing, mode: 'writer', context: carrying()});
    await ask(view);

    fireEvent.click(contextTab(view));
    await act(async function () {
      held.open();
      await drainReactScheduler();
    });

    expect(conversationTab(view).getAttribute('aria-label')).toBe('Transcript, new reply');
    expect(conversationTab(view).getAttribute('aria-selected')).toBe('false');
  });
});

describe('reporting focus', function () {
  it('should report focus landing on the conversation switcher', function () {
    let reported = 0;
    const view = panel({
      started: 3,
      onFocus() {
        reported += 1;
      },
    });

    fireEvent.focus(view.getByLabelText('Conversation'));

    expect(reported).toBe(1);
  });

  // The composer is neutral. Typing a message is not a claim on the turn: a
  // writer whose cursor is in the document still expects to be asked first.
  it('should report nothing when focus lands on the composer', function () {
    let reported = 0;
    const view = panel({
      started: 3,
      onFocus() {
        reported += 1;
      },
    });

    fireEvent.focus(view.getByLabelText('Message the agent'));

    expect(reported).toBe(0);
  });
});

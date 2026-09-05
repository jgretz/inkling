import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {DocPath} from '@inkling/vault';
import type {HeldSessionState} from '@inkling/toryo';
import {
  INTERRUPTED_TEXT,
  type Conversation,
  type ConversationStore,
  type StoredTurn,
  type TurnState,
} from '../src/lib/conversations.ts';
import {useConversations} from '../src/lib/use-conversations.ts';

autoCleanup();

const DOC = 'drafts/a.md' as DocPath;

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    docPath: DOC,
    title: 'On endings',
    sessionId: null,
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function turn(overrides: Partial<StoredTurn> = {}): StoredTurn {
  return {
    id: 1,
    conversationId: 1,
    asked: 'Tighten this',
    answered: 'Here you are.',
    state: 'answered',
    snapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A store over an in-memory vault, recording the writes a caller made. */
function vault(rows: Conversation[], turns: StoredTurn[]) {
  const sessions: Array<{id: number; sessionId: string | null; resumeSessionId: string | null}> =
    [];
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;

  const store: ConversationStore = {
    list(docPath) {
      return Promise.resolve(
        rows.filter(function (row) {
          return row.docPath === docPath;
        }),
      );
    },
    create(docPath, title) {
      const started = conversation({id: nextId++, docPath, title});
      rows.push(started);
      return Promise.resolve(started);
    },
    rename(id, title) {
      const row = rows.find((entry) => entry.id === id);
      if (row) row.title = title;
      return Promise.resolve();
    },
    remove(id) {
      const at = rows.findIndex((entry) => entry.id === id);
      if (at !== -1) rows.splice(at, 1);
      return Promise.resolve();
    },
    setSession(id, sessionId, resumeSessionId) {
      sessions.push({id, sessionId, resumeSessionId});
      const row = rows.find((entry) => entry.id === id);
      if (row) {
        row.sessionId = sessionId;
        row.resumeSessionId = resumeSessionId;
      }
      return Promise.resolve();
    },
    listTurns(conversationId) {
      return Promise.resolve(
        turns.filter(function (entry) {
          return entry.conversationId === conversationId;
        }),
      );
    },
    startTurn(conversationId, asked, snapshot) {
      const row = turn({
        id: turns.length + 100,
        conversationId,
        asked,
        snapshot,
        state: 'pending',
        answered: null,
      });
      turns.push(row);
      return Promise.resolve(row);
    },
    finishTurn(id, state: Exclude<TurnState, 'pending'>, answered) {
      const row = turns.find((entry) => entry.id === id);
      if (row === undefined) throw new Error(`no turn ${id}`);
      row.state = state;
      row.answered = answered;
      return Promise.resolve(row);
    },
  };

  return {store, rows, turns, sessions};
}

/** A daemon that always reports the same state, or has never heard of a session. */
function reports(state: HeldSessionState | undefined) {
  return function () {
    return Promise.resolve(state);
  };
}

function mount(store: ConversationStore, sessionState = reports('live' as HeldSessionState)) {
  return renderHook(function () {
    return useConversations({store, docPath: DOC, ready: true, sessionState});
  });
}

describe('useConversations', function () {
  it('should return an answered conversation as messages in order after a remount', async function () {
    const {store} = vault(
      [conversation()],
      [turn(), turn({id: 2, asked: 'And the opening?', answered: 'Cut the first line.'})],
    );

    const {result} = mount(store);

    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });
    expect(
      result.current.initial.map(function (message) {
        return [message.role, message.text];
      }),
    ).toEqual([
      ['writer', 'Tighten this'],
      ['agent', 'Here you are.'],
      ['writer', 'And the opening?'],
      ['agent', 'Cut the first line.'],
    ]);
  });

  it('should start a conversation for a document that has none', async function () {
    const {store, rows} = vault([], []);

    const {result} = mount(store);

    await waitFor(function () {
      expect(result.current.active).toBeDefined();
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.docPath).toBe(DOC);
  });

  // The event stream has no backlog, so the reply that landed while inkling was
  // closed cannot be recovered. Rendering it as an answer would mean inventing
  // one.
  it('should render a pending turn as interrupted when its session is not live', async function () {
    const {store, turns} = vault(
      [conversation({sessionId: 's-1'})],
      [turn({state: 'pending', answered: null})],
    );

    const {result} = mount(store, reports('closed'));

    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.initial[1]?.text).toBe(INTERRUPTED_TEXT);
    expect(result.current.initial[1]?.pending).toBeUndefined();
    expect(turns[0]?.state).toBe('interrupted');
  });

  it('should demote a session the daemon no longer calls live to a resume id', async function () {
    const {store, sessions} = vault(
      [conversation({sessionId: 's-1'})],
      [turn({state: 'pending', answered: null})],
    );

    const {result} = mount(store, reports(undefined));

    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });
    expect(sessions).toContainEqual({id: 1, sessionId: null, resumeSessionId: 's-1'});
  });

  it('should keep a session the daemon still calls live', async function () {
    const {store, sessions} = vault(
      [conversation({sessionId: 's-1'})],
      [turn({state: 'pending', answered: null})],
    );

    const {result} = mount(store, reports('live'));

    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });
    expect(sessions).toEqual([]);
    expect(result.current.active?.sessionId).toBe('s-1');
  });

  it('should make the newest conversation the active one', async function () {
    const {store} = vault(
      [conversation(), conversation({id: 2, title: 'On openings'})],
      [turn({conversationId: 2, asked: 'Second', answered: 'Reply'})],
    );

    const {result} = mount(store);

    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.active?.title).toBe('On openings');
    expect(result.current.initial[0]?.text).toBe('Second');
  });

  it('should replace the messages when another conversation is selected', async function () {
    const {store} = vault(
      [conversation(), conversation({id: 2, title: 'On openings'})],
      [turn(), turn({id: 2, conversationId: 2, asked: 'Second', answered: 'Reply'})],
    );
    const {result} = mount(store);
    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });

    act(function () {
      result.current.select(1);
    });

    await waitFor(function () {
      expect(result.current.initial[0]?.text).toBe('Tighten this');
    });
  });

  it('should start another conversation and make it the active one', async function () {
    const {store, rows} = vault([conversation()], [turn()]);
    const {result} = mount(store);
    await waitFor(function () {
      expect(result.current.loaded).toBe(true);
    });

    act(function () {
      result.current.create();
    });

    await waitFor(function () {
      expect(result.current.all).toHaveLength(2);
    });
    expect(rows[1]?.title).toBe('Conversation 2');
    expect(result.current.active?.id).toBe(rows[1]?.id);
    expect(result.current.initial).toEqual([]);
  });

  it('should fall back to the one before it when a conversation is deleted', async function () {
    const {store} = vault([conversation(), conversation({id: 2, title: 'On openings'})], [turn()]);
    const {result} = mount(store);
    await waitFor(function () {
      expect(result.current.active?.id).toBe(2);
    });

    act(function () {
      result.current.remove(2);
    });

    await waitFor(function () {
      expect(result.current.active?.id).toBe(1);
    });
    expect(result.current.all).toHaveLength(1);
  });

  it('should read nothing while the vault database is not open', async function () {
    const {store, rows} = vault([], []);
    const probe = reports('live' as HeldSessionState);

    const {result} = renderHook(function () {
      return useConversations({store, docPath: DOC, ready: false, sessionState: probe});
    });

    await waitFor(function () {
      expect(result.current.all).toEqual([]);
    });
    expect(rows).toEqual([]);
  });
});

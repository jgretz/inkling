import {describe, expect, it} from 'bun:test';
import {
  INTERRUPTED_TEXT,
  messagesOf,
  pendingTurn,
  type StoredTurn,
} from '../src/lib/conversations.ts';

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

describe('messagesOf', function () {
  it('should give a turn two messages, the writer first', function () {
    expect(
      messagesOf([turn()]).map(function (message) {
        return [message.role, message.text];
      }),
    ).toEqual([
      ['writer', 'Tighten this'],
      ['agent', 'Here you are.'],
    ]);
  });

  // The same turn keeps the same React key across a remount, which is what lets
  // the panel be rebuilt from the database without every bubble re-animating.
  it('should derive a stable id from the row rather than counting', function () {
    const first = messagesOf([turn()]);
    const again = messagesOf([turn()]);

    expect(first.map((message) => message.id)).toEqual(['t1w', 't1a']);
    expect(again.map((message) => message.id)).toEqual(first.map((message) => message.id));
  });

  it('should render a failed turn as a failure, in the words it failed with', function () {
    const [, reply] = messagesOf([
      turn({state: 'failed', answered: 'the toryo daemon is unreachable'}),
    ]);

    expect(reply?.text).toBe('Failed: the toryo daemon is unreachable');
  });

  it('should render a failed turn that carries no words at all', function () {
    const [, reply] = messagesOf([turn({state: 'failed', answered: null})]);

    expect(reply?.text).toBe('Failed: the turn did not finish');
  });

  it('should render an interrupted turn as one that ended with inkling closed', function () {
    const [, reply] = messagesOf([turn({state: 'interrupted', answered: null})]);

    expect(reply?.text).toBe(INTERRUPTED_TEXT);
    expect(reply?.pending).toBeUndefined();
  });

  it('should render a pending turn with the caret still on it', function () {
    const [, reply] = messagesOf([turn({state: 'pending', answered: null})]);

    expect(reply?.text).toBe('');
    expect(reply?.pending).toBe(true);
  });

  it('should return nothing for a conversation that has said nothing', function () {
    expect(messagesOf([])).toEqual([]);
  });
});

describe('pendingTurn', function () {
  it('should find a turn still in flight at the end of a conversation', function () {
    const last = turn({id: 2, state: 'pending', answered: null});

    expect(pendingTurn([turn(), last])).toBe(last);
  });

  // Only the last one. An earlier pending row is a turn some previous launch
  // already resolved, or would have; re-resolving it would rewrite history.
  it('should ignore a pending turn that is not the last', function () {
    expect(pendingTurn([turn({state: 'pending', answered: null}), turn({id: 2})])).toBeUndefined();
  });

  it('should find nothing in an empty conversation', function () {
    expect(pendingTurn([])).toBeUndefined();
  });
});

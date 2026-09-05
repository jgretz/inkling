import {describe, expect, it} from 'bun:test';
import {
  INTERRUPTED_TEXT,
  messagesOf,
  pendingTurn,
  type StoredTurn,
} from '../src/lib/conversations.ts';
import {FENCE} from '../src/lib/reply.ts';

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

describe('a stored turn that carried a block', function () {
  const SNAPSHOT = 'The ending is rather good, and the opening is not.';

  /** A stored answer as the row holds it: the prose, then the raw block. */
  function answered(body: Record<string, unknown>, prose = 'The ending is the strong half.') {
    return turn({
      snapshot: SNAPSHOT,
      answered: `${prose}\n\n${FENCE}\n${JSON.stringify(body)}\n\`\`\``,
    });
  }

  // The streaming filter only ran live, so without reading the row back through
  // the reply reader, re-opening a conversation would show the writer the JSON
  // the panel hid while it arrived.
  it('should render the prose alone, never the block', function () {
    const [, reply] = messagesOf([answered({kind: 'point', quote: 'rather good'})]);

    expect(reply?.text).toBe('The ending is the strong half.');
  });

  it('should show no block for a stored edit either', function () {
    const [, reply] = messagesOf([
      answered({kind: 'proposed', quote: 'rather good', replacement: 'good'}),
    ]);

    expect(reply?.text).toBe('The ending is the strong half.');
    expect(reply?.pointer).toBeUndefined();
  });

  // Built against the snapshot, the document as the agent saw it, so the anchor
  // records the context that was actually around the passage.
  it('should rebuild the pointer a stored point block named', function () {
    const [, reply] = messagesOf([answered({kind: 'point', quote: 'rather good'})]);

    expect(reply?.pointer?.quote).toBe('rather good');
    expect(reply?.pointer?.anchor.hint).toBe(SNAPSHOT.indexOf('rather good'));
  });

  // The turn is over and there is nothing left to answer, so the transcript says
  // nothing about it rather than raising a notice a week after the fact.
  it('should yield the prose and no pointer when the snapshot lost the passage', function () {
    const [, reply] = messagesOf([answered({kind: 'point', quote: 'the closing line'})]);

    expect(reply?.text).toBe('The ending is the strong half.');
    expect(reply?.pointer).toBeUndefined();
  });

  it('should yield no pointer when the snapshot holds the passage twice', function () {
    const [, reply] = messagesOf([
      turn({
        snapshot: 'One. Two. One.',
        answered: `Both of them.\n\n${FENCE}\n${JSON.stringify({kind: 'point', quote: 'One.'})}\n\`\`\``,
      }),
    ]);

    expect(reply?.text).toBe('Both of them.');
    expect(reply?.pointer).toBeUndefined();
  });

  it('should leave an ordinary answer exactly as it was said', function () {
    const [, reply] = messagesOf([turn({answered: 'Cut the last line.'})]);

    expect(reply?.text).toBe('Cut the last line.');
    expect(reply?.pointer).toBeUndefined();
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

import {describe, expect, it} from 'bun:test';
import {
  applyEdit,
  createFenceFilter,
  FENCE,
  parseReply,
  type AgentReply,
} from '../src/lib/reply.ts';

/**
 * The reply contract, both halves.
 *
 * A held session carries no structured return, so everything the app knows
 * about what a turn said it learns here. That makes this the file where a
 * malformed reply has to stop: anything that reaches a caller is one of four
 * shapes, and only two of them carry an edit.
 */

const PROSE = 'Cut the qualifier. It is doing nothing for you.';

/** A reply carrying one block, written the way the prompt asks for it. */
function withBlock(body: string, prose = PROSE): string {
  return `${prose}\n\n${FENCE}\n${body}\n\`\`\``;
}

function block(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** The reason a refused reply carries, and a failed test when it was not refused. */
function refusal(reply: AgentReply): string {
  if (reply.kind !== 'refused') {
    throw new Error(`the reply should have been refused but was ${reply.kind}`);
  }
  return reply.reason;
}

describe('parseReply', function () {
  it('should read a reply with no block as an answer', function () {
    const reply = parseReply(PROSE, false);

    expect(reply).toEqual({kind: 'answer', text: PROSE});
  });

  it('should read a well-formed block on the writers turn as a proposal', function () {
    const raw = withBlock(block({kind: 'proposed', quote: 'rather good', replacement: 'good'}));

    const reply = parseReply(raw, false);

    expect(reply).toEqual({
      kind: 'proposed',
      text: PROSE,
      edit: {quote: 'rather good', replacement: 'good'},
    });
  });

  it('should read a well-formed block on the agents turn as an edit made', function () {
    const raw = withBlock(block({kind: 'made', quote: 'rather good', replacement: 'good'}));

    const reply = parseReply(raw, true);

    expect(reply).toEqual({
      kind: 'made',
      text: PROSE,
      edit: {quote: 'rather good', replacement: 'good'},
    });
  });

  // A proposal is legal on either turn: an agent that would rather ask may.
  it('should still allow a proposal on the agents own turn', function () {
    const raw = withBlock(block({kind: 'proposed', quote: 'rather good', replacement: 'good'}));

    expect(parseReply(raw, true).kind).toBe('proposed');
  });

  it('should keep an empty replacement, which is a deletion rather than a mistake', function () {
    const raw = withBlock(block({kind: 'proposed', quote: 'rather ', replacement: ''}));

    const reply = parseReply(raw, false);

    expect(reply).toEqual({
      kind: 'proposed',
      text: PROSE,
      edit: {quote: 'rather ', replacement: ''},
    });
  });
});

describe('a reply that is refused', function () {
  it('should refuse a block that is not readable as JSON', function () {
    const reply = parseReply(withBlock('{kind: made, quote: "x"'), true);

    expect(refusal(reply)).toContain('JSON');
  });

  it('should refuse a kind that is neither made nor proposed', function () {
    const raw = withBlock(block({kind: 'rewritten', quote: 'x', replacement: 'y'}));

    expect(refusal(parseReply(raw, true))).toContain('rewritten');
  });

  it('should refuse a block carrying no replacement', function () {
    const raw = withBlock(block({kind: 'proposed', quote: 'rather good'}));

    expect(refusal(parseReply(raw, false))).toContain('replacement');
  });

  it('should refuse a block naming no passage to replace', function () {
    const raw = withBlock(block({kind: 'proposed', quote: '', replacement: 'good'}));

    expect(refusal(parseReply(raw, false))).toContain('no passage');
  });

  // The whole reason authorization is captured at send time: the agent does not
  // get to decide afterwards that its turn was its own.
  it('should refuse an edit claimed as made on a turn that did not authorize one', function () {
    const raw = withBlock(block({kind: 'made', quote: 'rather good', replacement: 'good'}));

    expect(refusal(parseReply(raw, false))).toContain('was yours');
  });

  // One quote and one replacement per reply. Multi-hunk edits are 4c's problem.
  it('should refuse a reply carrying more than one block', function () {
    const raw = `${withBlock(block({kind: 'proposed', quote: 'a', replacement: 'b'}))}\n\n${FENCE}\n${block(
      {kind: 'proposed', quote: 'c', replacement: 'd'},
    )}\n\`\`\``;

    expect(refusal(parseReply(raw, false))).toContain('more than one');
  });

  it('should refuse a block the turn ended in the middle of', function () {
    const raw = `${PROSE}\n\n${FENCE}\n{"kind": "proposed", "quote": "a"`;

    expect(refusal(parseReply(raw, false))).toContain('never closed');
  });

  it('should leave a refused reply with no edit for a caller to apply', function () {
    const raw = withBlock(block({kind: 'made', quote: 'rather good', replacement: 'good'}));

    const reply = parseReply(raw, false);

    expect(reply.kind).toBe('refused');
    expect('edit' in reply).toBe(false);
  });

  it('should keep the prose of a reply whose block it refused', function () {
    const reply = parseReply(withBlock('not json at all'), true);

    expect(reply.text).toBe(PROSE);
  });
});

/** Everything `push` let through, plus whatever `end` released at the close. */
function filtered(chunks: readonly string[]): string {
  const filter = createFenceFilter();
  const shown = chunks
    .map(function (chunk) {
      return filter.push(chunk);
    })
    .join('');
  return shown + filter.end();
}

describe('the streaming filter', function () {
  it('should let ordinary prose through as it arrives', function () {
    expect(filtered(['Cut the ', 'qualifier.'])).toBe('Cut the qualifier.');
  });

  it('should show the prose and none of the block when a reply carries one', function () {
    const raw = withBlock(block({kind: 'proposed', quote: 'rather good', replacement: 'good'}));

    const shown = filtered([raw]);

    expect(shown.trim()).toBe(PROSE);
    expect(shown).not.toContain(FENCE);
    expect(shown).not.toContain('replacement');
  });

  it('should hold back a marker split across chunks rather than showing half of it', function () {
    const chunks = [
      PROSE,
      '\n\n``',
      '`ink',
      'ling\n',
      block({kind: 'made', quote: 'a', replacement: 'b'}),
      '\n```',
    ];

    const shown = filtered(chunks);

    expect(shown.trim()).toBe(PROSE);
    expect(shown).not.toContain('```');
  });

  // A tail that could have been the start of a marker and turned out not to be
  // is prose the writer is owed, so the close releases it.
  it('should release a tail that looked like a marker and was not', function () {
    expect(filtered(['Wrap it in ', '``'])).toBe('Wrap it in ``');
  });

  it('should emit nothing after the marker even on chunks that follow it', function () {
    const filter = createFenceFilter();
    filter.push(`${PROSE}\n\n${FENCE}\n`);

    const after = filter.push(block({kind: 'made', quote: 'a', replacement: 'b'}));

    expect(after).toBe('');
    expect(filter.end()).toBe('');
  });
});

describe('applyEdit', function () {
  const SOURCE = 'The ending is rather good, and the opening is not.';

  it('should replace the passage the agent quoted', function () {
    const applied = applyEdit(SOURCE, {quote: 'rather good', replacement: 'good'});

    expect(applied).toEqual({ok: true, value: 'The ending is good, and the opening is not.'});
  });

  it('should cut the passage when the replacement is empty', function () {
    const applied = applyEdit(SOURCE, {quote: 'rather ', replacement: ''});

    expect(applied).toEqual({ok: true, value: 'The ending is good, and the opening is not.'});
  });

  // The honest answer while anchoring is still 4c's work: the writer edited the
  // paragraph while the agent was thinking about it.
  it('should refuse a quote that is no longer in the document', function () {
    const applied = applyEdit(SOURCE, {quote: 'quite good', replacement: 'good'});

    expect(applied).toEqual({
      ok: false,
      reason: 'The passage the agent quoted is not in the document any more.',
    });
  });

  it('should refuse a quote that appears more than once', function () {
    const applied = applyEdit('One. Two. One.', {quote: 'One.', replacement: 'Three.'});

    expect(applied.ok).toBe(false);
    expect(applied.ok === false && applied.reason).toContain('more than once');
  });
});

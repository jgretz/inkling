import {describe, expect, it} from 'bun:test';
import type {DocPath} from '@inkling/vault';
import {contextTokens, emptyContext, estimateTokens, stubTransport} from '../src/lib/agent.ts';

describe('estimateTokens', function () {
  it('should return zero for empty text', function () {
    expect(estimateTokens('')).toBe(0);
  });

  it('should round up rather than under-report a budget', function () {
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('contextTokens', function () {
  it('should be zero when nothing is attached', function () {
    expect(contextTokens(emptyContext())).toBe(0);
  });

  it('should total the document, the selection and every pinned file', function () {
    const total = contextTokens({
      doc: {path: 'a.md' as DocPath, title: 'A', source: 'x'.repeat(400)},
      selection: 'y'.repeat(40),
      pinned: [{path: 'b.md' as DocPath, title: 'B', source: 'z'.repeat(80)}],
    });

    expect(total).toBe(100 + 10 + 20);
  });
});

describe('stubTransport', function () {
  it('should stop yielding once the turn is aborted', async function () {
    const controller = new AbortController();
    const chunks: string[] = [];

    for await (const chunk of stubTransport.send(
      {message: 'hello', context: emptyContext(), history: []},
      controller.signal,
    )) {
      chunks.push(chunk);
      controller.abort();
    }

    expect(chunks).toHaveLength(1);
  });
});

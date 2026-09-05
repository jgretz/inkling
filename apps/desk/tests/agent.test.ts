import {describe, expect, it} from 'bun:test';
import type {DocPath} from '@inkling/vault';
import {contextTokens, emptyContext, estimateTokens} from '../src/lib/agent.ts';
import {pointerAt} from '../src/lib/pointer.ts';
import type {ContextReference} from '../src/lib/references.ts';

/** An assembled reference carrying `source`, as `assembleReferences` returns one. */
function reference(source: string): ContextReference {
  return {
    id: 1,
    kind: 'doc',
    title: 'B',
    source,
    target: 'b.md',
    origin: {level: 'document'},
    missing: false,
    suppressedBy: undefined,
    tokens: estimateTokens(source),
  };
}

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

  it('should total the document, the selection and every reference', function () {
    const total = contextTokens({
      doc: {path: 'a.md' as DocPath, title: 'A', source: 'x'.repeat(400)},
      // Only the quote costs anything: the anchor is inkling's own bookkeeping
      // and never leaves the machine.
      selection: pointerAt('y'.repeat(40), 0, 40),
      references: [reference('z'.repeat(80))],
    });

    expect(total).toBe(100 + 10 + 20);
  });

  // A link, a file the vault lost and one this document turned off all come
  // back with an empty source, so none of them may cost anything here.
  it('should count nothing for a reference that carries no body', function () {
    const total = contextTokens({
      doc: undefined,
      selection: undefined,
      references: [reference('')],
    });

    expect(total).toBe(0);
  });
});

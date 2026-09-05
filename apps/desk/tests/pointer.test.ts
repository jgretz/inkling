import {describe, expect, it} from 'bun:test';
import {resolveAnchor} from '@inkling/voice';
import {locate, pointerAt, pointerFor} from '../src/lib/pointer.ts';

/**
 * Pointing, as the pure half of it.
 *
 * Two rules and nothing else: a quote is located exactly and only once, and what
 * is kept afterwards is an anchor rather than a position. The second is what the
 * resolve cases below are about, and it is why a pointer survives the writer
 * editing above it.
 */

const SOURCE = 'The ending is rather good, and the opening is not.';

describe('locate', function () {
  it('should find the one place a quote appears', function () {
    expect(locate(SOURCE, 'rather good')).toEqual({ok: true, start: 14});
  });

  it('should refuse a quote that is not there', function () {
    expect(locate(SOURCE, 'quite good')).toEqual({
      ok: false,
      reason: 'The passage the agent quoted is not in the document any more.',
    });
  });

  // Not a position the writer did not mean: two candidates is no answer.
  it('should refuse a quote that appears twice', function () {
    const found = locate('One. Two. One.', 'One.');

    expect(found.ok).toBe(false);
    expect(found.ok === false && found.reason).toContain('more than once');
  });
});

describe('pointerAt', function () {
  it('should keep the selected text as the quote', function () {
    expect(pointerAt(SOURCE, 14, 25).quote).toBe('rather good');
  });

  it('should record what surrounds the passage, not only where it was', function () {
    const pointer = pointerAt(SOURCE, 14, 25);

    expect(pointer.anchor.prefix.endsWith('The ending is ')).toBe(true);
    expect(pointer.anchor.suffix.startsWith(', and the opening')).toBe(true);
    expect(pointer.anchor.hint).toBe(14);
  });

  it('should point at an empty span as an empty quote', function () {
    // Nothing selected is not a pointer, and the panel never makes one. Pinned
    // so that a caller which does gets an anchor that resolves to nothing rather
    // than to the whole document.
    const pointer = pointerAt(SOURCE, 14, 14);

    expect(pointer.quote).toBe('');
    expect(resolveAnchor(SOURCE, pointer.anchor)).toBeUndefined();
  });
});

describe('pointerFor', function () {
  it('should build a pointer at the quote it was given', function () {
    const found = pointerFor(SOURCE, 'rather good');

    expect(found.ok).toBe(true);
    expect(found.ok === true && found.value.quote).toBe('rather good');
    expect(found.ok === true && found.value.anchor.hint).toBe(14);
  });

  it('should pass on the reason a quote could not be located', function () {
    expect(pointerFor(SOURCE, 'quite good')).toEqual({
      ok: false,
      reason: 'The passage the agent quoted is not in the document any more.',
    });
  });

  it('should refuse a quote the source holds twice', function () {
    const found = pointerFor('One. Two. One.', 'One.');

    expect(found.ok).toBe(false);
  });
});

describe('a pointer against an edited draft', function () {
  // The whole reason a pointer is a quote and an anchor rather than a range.
  it('should still resolve after the paragraph above it is rewritten', function () {
    const found = pointerFor(SOURCE, 'rather good');
    if (!found.ok) throw new Error(found.reason);

    const edited = `A whole new opening paragraph, considerably longer.\n\n${SOURCE}`;
    const range = resolveAnchor(edited, found.value.anchor);
    if (range === undefined) throw new Error('the anchor stopped resolving');

    expect(edited.slice(range.start, range.end)).toBe('rather good');
    expect(range.start).not.toBe(14);
  });

  // Two identical sentences, and the anchor lands on the one it was made from.
  it('should stay on its own passage when the draft repeats it', function () {
    const source = 'Say it once. Then say it twice. Say it once.';
    const found = pointerFor(source.slice(0, 31), 'Say it once.');
    if (!found.ok) throw new Error(found.reason);

    const range = resolveAnchor(source, found.value.anchor);

    expect(range).toEqual({start: 0, end: 12});
  });

  it('should resolve to nothing once the passage is deleted', function () {
    const found = pointerFor(SOURCE, 'rather good');
    if (!found.ok) throw new Error(found.reason);

    expect(resolveAnchor('The ending is fine now.', found.value.anchor)).toBeUndefined();
  });
});

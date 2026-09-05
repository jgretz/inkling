import {describe, expect, it} from 'bun:test';
import {resolveAnchor} from '@inkling/voice';
import {locate, pointerAt, pointerFor, resolvePointer} from '../src/lib/pointer.ts';

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
    expect(locate(SOURCE, 'quite good')).toEqual({ok: false, miss: 'missing'});
  });

  // Not a position the writer did not mean: two candidates is no answer.
  it('should refuse a quote that appears twice', function () {
    expect(locate('One. Two. One.', 'One.')).toEqual({ok: false, miss: 'ambiguous'});
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

  it('should pass on why a quote could not be located', function () {
    expect(pointerFor(SOURCE, 'quite good')).toEqual({ok: false, miss: 'missing'});
  });

  it('should refuse a quote the source holds twice', function () {
    expect(pointerFor('One. Two. One.', 'One.')).toEqual({ok: false, miss: 'ambiguous'});
  });
});

describe('resolvePointer', function () {
  /** A pointer at `quote`, as the chat would hand one to `App`. */
  function pointer(source: string, quote: string) {
    const found = pointerFor(source, quote);
    if (!found.ok) throw new Error(`the fixture quote was ${found.miss}`);
    return found.value;
  }

  it('should find the passage where it now stands, not where it stood', function () {
    const draft = `A whole new opening paragraph.\n\n${SOURCE}`;

    const found = resolvePointer(draft, pointer(SOURCE, 'rather good'));

    expect(found.ok).toBe(true);
    expect(found.ok === true && draft.slice(found.range.start, found.range.end)).toBe(
      'rather good',
    );
    expect(found.ok === true && found.range.start).not.toBe(14);
  });

  // The sentence the status bar shows. Whole and capitalised, because `App` puts
  // it beside a save failure with nothing else around it.
  it('should say the passage has gone once the writer has deleted it', function () {
    expect(resolvePointer('The ending is fine now.', pointer(SOURCE, 'rather good'))).toEqual({
      ok: false,
      reason: 'The passage that was pointed at is not in the document any more.',
    });
  });

  // Two identical sentences, and the anchor lands on the one it was made from
  // rather than on the first the draft happens to hold.
  it('should stay on its own passage when the draft repeats it', function () {
    const draft = 'Say it once. Then say it twice. Say it once.';

    const found = resolvePointer(draft, pointer(draft.slice(0, 31), 'Say it once.'));

    expect(found).toEqual({ok: true, range: {start: 0, end: 12}});
  });
});

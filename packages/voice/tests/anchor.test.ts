import {describe, expect, it} from 'bun:test';
import {
  createAnchor,
  MIN_CONTEXT_AGREEMENT,
  resolveAnchor,
  resolveAnchorScored,
  resolvePassage,
} from '../src/anchor.ts';

const source = 'The trouble with most tools is that they answer a question nobody asked.';
const quote = 'answer a question';
const start = source.indexOf(quote);

describe('createAnchor', function () {
  it('should keep the quote with context on both sides', function () {
    const anchor = createAnchor(source, start, start + quote.length);

    expect(anchor.quote).toBe(quote);
    expect(anchor.prefix.endsWith('they ')).toBe(true);
    expect(anchor.suffix.startsWith(' nobody')).toBe(true);
    expect(anchor.hint).toBe(start);
  });
});

describe('resolveAnchor', function () {
  it('should resolve after text is inserted before the quote', function () {
    const anchor = createAnchor(source, start, start + quote.length);
    const edited = `A new opening paragraph sits above it.\n\n${source}`;

    const resolved = resolveAnchor(edited, anchor);

    expect(resolved).toBeDefined();
    expect(edited.slice(resolved?.start, resolved?.end)).toBe(quote);
    expect(resolved?.start).toBeGreaterThan(start);
  });

  it('should resolve after text is inserted after the quote', function () {
    const anchor = createAnchor(source, start, start + quote.length);
    const edited = `${source}\n\nAnd a second paragraph underneath.`;

    const resolved = resolveAnchor(edited, anchor);

    expect(resolved).toEqual({start, end: start + quote.length});
  });

  it('should return undefined when the quoted text is deleted', function () {
    const anchor = createAnchor(source, start, start + quote.length);
    const edited = source.replace(quote, 'say something');

    expect(resolveAnchor(edited, anchor)).toBeUndefined();
  });

  it('should pick the occurrence whose context still agrees when the quote repeats', function () {
    const repeated = 'the panel is quiet. the panel is loud. the panel is quiet.';
    const second = repeated.lastIndexOf('the panel');
    const anchor = createAnchor(repeated, second, second + 'the panel'.length);

    const resolved = resolveAnchor(repeated, anchor);

    expect(resolved?.start).toBe(second);
  });

  it('should fall back to the hint when two occurrences have identical context', function () {
    const original = 'left. middle. right.';
    const anchor = createAnchor(original, 6, 12);
    const duplicated = `${original} ${original}`;

    expect(resolveAnchor(duplicated, anchor)?.start).toBe(6);
  });

  it('should return undefined for an empty quote', function () {
    expect(resolveAnchor(source, {quote: '', prefix: '', suffix: '', hint: 0})).toBeUndefined();
  });
});

describe('resolveAnchorScored', function () {
  it('should report full agreement against the unchanged source', function () {
    const anchor = createAnchor(source, start, start + quote.length);

    const resolved = resolveAnchorScored(source, anchor);

    expect(resolved?.range).toEqual({start, end: start + quote.length});
    expect(resolved?.agreement).toBe(1);
  });

  it('should report full agreement for an anchor that remembered no context', function () {
    const resolved = resolveAnchorScored('—', {quote: '—', prefix: '', suffix: '', hint: 0});

    expect(resolved?.agreement).toBe(1);
  });
});

describe('resolvePassage', function () {
  const before = 'Tuesday — the meeting day.\n\nSheep, counted — one at a time.';
  const after = 'Tuesday — the meeting day.\n\nSheep, counted, one at a time.';
  const second = before.lastIndexOf('—');
  const survivor = after.indexOf('—');

  it('should return the passage while its context still agrees', function () {
    const anchor = createAnchor(before, second, second + 1);

    expect(resolvePassage(before, anchor)).toEqual({start: second, end: second + 1});
  });

  /**
   * The anchored em dash was deleted. The only one left is somebody else's:
   * the quote is still in the document, but not the passage.
   */
  it('should refuse a landing that kept too little of its context', function () {
    const anchor = createAnchor(before, second, second + 1);

    const scored = resolveAnchorScored(after, anchor);

    expect(scored?.range).toEqual({start: survivor, end: survivor + 1});
    expect(scored?.agreement).toBeLessThan(MIN_CONTEXT_AGREEMENT);
    expect(resolvePassage(after, anchor)).toBeUndefined();
  });

  it('should leave resolveAnchor answering where the quote is', function () {
    const anchor = createAnchor(before, second, second + 1);

    expect(resolveAnchor(after, anchor)).toEqual({start: survivor, end: survivor + 1});
  });

  it('should return undefined when the quote is gone', function () {
    const anchor = createAnchor(before, second, second + 1);

    expect(resolvePassage('No dashes here at all.', anchor)).toBeUndefined();
  });

  it('should resolve the same span as resolveAnchor after text is inserted before the quote', function () {
    const anchor = createAnchor(source, start, start + quote.length);
    const edited = `A new opening paragraph sits above it.\n\n${source}`;

    const resolved = resolvePassage(edited, anchor);

    expect(resolved).toEqual(resolveAnchor(edited, anchor));
    expect(edited.slice(resolved?.start, resolved?.end)).toBe(quote);
  });

  it('should refuse the duplicate that resolveAnchor lands on once the original is deleted', function () {
    const original = 'Say it once. Then say it twice. Say it once.';
    const anchor = createAnchor(original, 0, 'Say it once.'.length);
    const edited = 'Then say it twice. Say it once.';

    expect(resolveAnchor(edited, anchor)).toEqual({start: 19, end: 31});
    expect(resolvePassage(edited, anchor)).toBeUndefined();
  });

  it('should accept a landing where exactly half the context still agrees', function () {
    const anchor = {quote: 'X', prefix: 'ab', suffix: 'cd', hint: 0};

    expect(resolvePassage('abXzz', anchor)).toEqual({start: 2, end: 3});
  });

  it('should refuse a landing where less than half the context still agrees', function () {
    const anchor = {quote: 'X', prefix: 'ab', suffix: 'cd', hint: 0};

    expect(resolvePassage('zbXzz', anchor)).toBeUndefined();
  });

  it('should resolve a quote with no remembered context', function () {
    expect(resolvePassage('X', {quote: 'X', prefix: '', suffix: '', hint: 0})).toEqual({
      start: 0,
      end: 1,
    });
  });

  it('should return undefined for an empty quote', function () {
    expect(resolvePassage(source, {quote: '', prefix: '', suffix: '', hint: 0})).toBeUndefined();
  });
});

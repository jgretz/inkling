import {describe, expect, it} from 'bun:test';
import {createAnchor, resolveAnchor, resolvePassage} from '../src/anchor.ts';

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

describe('resolvePassage', function () {
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

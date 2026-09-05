import {describe, expect, it} from 'bun:test';
import {copyRichText} from '../src/lib/clipboard.ts';

/**
 * The clipboard write, against a stub rather than the real pasteboard.
 *
 * happy-dom provides `ClipboardItem` and `Blob`, so the item the app builds is
 * the real one; only the place it is written to is replaced.
 */

function recorder() {
  const written: ClipboardItems[] = [];
  return {
    written,
    async write(items: ClipboardItems) {
      written.push(items);
    },
  };
}

/** The single element, or a failed test rather than an `undefined` to chain off. */
function only<T>(items: readonly T[] | undefined): T {
  expect(items).toHaveLength(1);
  const first = items?.[0];
  if (first === undefined) throw new Error('expected exactly one element');
  return first;
}

describe('copyRichText', function () {
  // One write carrying one item: two writes would leave whichever ran last
  // alone on the pasteboard, which is the failure this shape exists to prevent.
  it('should write both flavours in a single item', async function () {
    const target = recorder();

    const result = await copyRichText('<p>Body</p>', 'Body', target);

    expect(result).toEqual({ok: true});
    const item = only(only(target.written));
    expect(item.types).toEqual(['text/html', 'text/plain']);
  });

  it('should put the rendered HTML and the plain text on their own flavours', async function () {
    const target = recorder();

    await copyRichText('<p>Body</p>', 'Body', target);

    const item = only(only(target.written));
    expect(await (await item.getType('text/html')).text()).toBe('<p>Body</p>');
    expect(await (await item.getType('text/plain')).text()).toBe('Body');
  });

  it('should report the rejection rather than throwing when the write is refused', async function () {
    const target = {
      async write() {
        throw new Error('the document is not focused');
      },
    };

    const result = await copyRichText('<p>Body</p>', 'Body', target);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('the document is not focused');
  });

  it('should report having nowhere to write rather than throwing', async function () {
    const result = await copyRichText('<p>Body</p>', 'Body', undefined);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.length > 0).toBe(true);
  });
});

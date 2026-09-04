import {describe, expect, it} from 'bun:test';
import {extract, findingAt, sentenceAt, spansMask, toSourceOffset} from '../src/prose.ts';

/** What survived masking, with the single spaces collapsed for readability. */
function reduced(source: string): string {
  return extract(source).text;
}

describe('extract masking', function () {
  it('should mask the frontmatter block including its fences', function () {
    const source = '---\ntitle: Draft\nkind: essay\n---\n\nThe opening line.';

    expect(reduced(source)).not.toContain('title: Draft');
    expect(reduced(source)).toContain('The opening line.');
  });

  it('should mask a fenced code block and leave the prose around it', function () {
    const source = 'Before.\n\n```ts\nconst dash = "—";\n```\n\nAfter.';

    expect(reduced(source)).not.toContain('const dash');
    expect(reduced(source)).toContain('Before.');
    expect(reduced(source)).toContain('After.');
  });

  it('should mask a fence that is never closed', function () {
    const source = 'Before.\n\n```\nconst unterminated = true;';

    expect(reduced(source)).not.toContain('unterminated');
  });

  it('should mask an inline code span', function () {
    expect(reduced('Call `delve()` when ready.')).not.toContain('delve');
  });

  it('should mask a link target and keep its visible text', function () {
    const source = 'See [the guide](https://example.com/a/long/path) for more.';

    expect(reduced(source)).toContain('the guide');
    expect(reduced(source)).not.toContain('example.com');
  });

  it('should mask an image target and keep its alt text', function () {
    const source = '![a diagram](./assets/diagram.png)';

    expect(reduced(source)).toContain('a diagram');
    expect(reduced(source)).not.toContain('diagram.png');
  });

  it('should mask a reference definition', function () {
    const source = 'Text.\n\n[guide]: https://example.com/guide\n';

    expect(reduced(source)).not.toContain('example.com');
  });

  it('should mask an autolink', function () {
    expect(reduced('Read <https://example.com/x> today.')).not.toContain('example.com');
  });

  it('should mask a bare url', function () {
    expect(reduced('Read https://example.com/x today.')).not.toContain('example.com');
  });

  it('should mask an html comment', function () {
    expect(reduced('Kept. <!-- hidden note --> Kept too.')).not.toContain('hidden note');
  });

  it('should mask a blockquote block, markers and all', function () {
    const source =
      'Mine.\n\n> A tool that hides — what it sends.\n> Second quoted line.\n\nMine again.';

    expect(reduced(source)).not.toContain('what it sends');
    expect(reduced(source)).toContain('Mine again.');
  });

  it('should keep heading hashes, emphasis markers and list bullets', function () {
    const source = '## A heading\n\n- **Bold term** and _emphasis_.';

    expect(reduced(source)).toContain('## A heading');
    expect(reduced(source)).toContain('- **Bold term** and _emphasis_.');
  });

  it('should not mask a four-space indented code block', function () {
    // A known limitation: telling one apart from a list continuation needs a
    // real block parser, and inkling's own prose uses fences.
    const source = 'Prose.\n\n    const indented = "—";\n';

    expect(reduced(source)).toContain('const indented');
  });
});

describe('toSourceOffset', function () {
  it('should map an offset past a masked region back to the original', function () {
    const source = '---\ntitle: Draft\n---\n\nThe word here.';
    const prose = extract(source);
    const offset = prose.text.indexOf('word');

    expect(source.slice(toSourceOffset(prose, offset), toSourceOffset(prose, offset + 4))).toBe(
      'word',
    );
  });

  it('should map the end of the reduced text to the end of the source', function () {
    const prose = extract('Plain prose.');

    expect(toSourceOffset(prose, prose.text.length)).toBe('Plain prose.'.length);
  });
});

describe('findingAt', function () {
  it('should produce a range indexing the original source past a masked region', function () {
    const source = [
      '---',
      'title: Draft',
      'kind: essay',
      '---',
      '',
      '```ts',
      'const noise = "a long block of masked code";',
      '```',
      '',
      'The sentence with an — em dash in it.',
    ].join('\n');
    const prose = extract(source);
    const at = prose.text.indexOf('—');

    const finding = findingAt(prose, 'em-dash', at, at + 1, 'fix it');

    expect(source.slice(finding.range.start, finding.range.end)).toBe('—');
    expect(finding.range.start).toBeGreaterThan(prose.text.indexOf('—'));
    expect(finding.anchor.quote).toBe('—');
  });

  it('should produce an anchor that resolves against the original source', function () {
    const source = 'Before.\n\n```\ncode\n```\n\nA — dash.';
    const prose = extract(source);
    const at = prose.text.indexOf('—');

    const finding = findingAt(prose, 'em-dash', at, at + 1, 'fix it');

    expect(finding.anchor.suffix.startsWith(' dash.')).toBe(true);
  });
});

describe('spansMask', function () {
  it('should reject a span that straddles a fence', function () {
    const source = 'open\n\n```\ncode\n```\n\nclose';
    const prose = extract(source);
    const start = prose.text.indexOf('open');
    const end = prose.text.indexOf('close') + 'close'.length;

    expect(spansMask(prose, start, end)).toBe(true);
  });

  it('should accept a span entirely inside kept text', function () {
    const source = 'open\n\n```\ncode\n```\n\nclose enough';
    const prose = extract(source);
    const start = prose.text.indexOf('close');

    expect(spansMask(prose, start, start + 'close'.length)).toBe(false);
  });
});

describe('sentenceAt', function () {
  it('should find the sentence containing an offset', function () {
    const prose = extract('First one here. Second one there.');
    const offset = prose.text.indexOf('there');

    expect(prose.text.slice(sentenceAt(prose, offset)?.start, sentenceAt(prose, offset)?.end)).toBe(
      'Second one there.',
    );
  });

  it('should return undefined for an offset in whitespace between blocks', function () {
    const prose = extract('One.\n\nTwo.');

    expect(sentenceAt(prose, prose.text.indexOf('One.') + 4)).toBeUndefined();
  });
});

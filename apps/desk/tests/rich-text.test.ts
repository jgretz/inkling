import {describe, expect, it} from 'bun:test';
import {docToHtml} from '../src/lib/rich-text.tsx';

/**
 * The HTML that goes on the clipboard. No `autoCleanup()`: this renders to a
 * string and needs no DOM.
 */

/**
 * A document reaching every element the override map claims, so the guards
 * below cover the whole map rather than whichever tags a shorter fixture
 * happened to produce.
 */
const DOC = `---
title: A piece
tags:
  - draft
odd_key: sensitive-value
---

# A piece

A paragraph with **bold**, *slanted*, \`inline()\` and a [link](https://example.com).

## A second heading

### A third

#### A fourth

- first
- second

1. one
2. two

| Column | Second |
| ------ | ------ |
| one    | two    |

\`\`\`ts
const x = 1;
\`\`\`

> A quote.

![A picture](https://example.com/picture.png)

---
`;

describe('docToHtml', function () {
  // Mail clients drop a stylesheet and keep a style attribute, so a class name
  // arrives as unstyled text. The `language-ts` react-markdown puts on a fenced
  // block's `<code>` is the one that would otherwise slip through.
  it('should carry no class attribute at all', function () {
    const html = docToHtml(DOC);

    expect(html).not.toContain('class=');
    expect(html).not.toContain('language-ts');
  });

  // Every tag the map claims, not one of them. An override quietly dropped, or
  // keyed to a tag the renderer never emits, leaves that element bare in Mail
  // and is invisible to an assertion that only looks at a paragraph.
  it('should style every element it renders inline', function () {
    const html = docToHtml(DOC);

    // `tbody` and `tr` are in the map to be stripped, not styled: they carry no
    // declarations, and React writes no attribute for an empty style object.
    const styled = [
      'h1',
      'h2',
      'h3',
      'h4',
      'p',
      'a',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'table',
      'thead',
      'th',
      'td',
      'hr',
      'img',
    ];

    const bare = styled.filter(function (tag) {
      return !new RegExp(`<${tag}\\b[^>]*\\sstyle="[^"]+"`).test(html);
    });

    expect(bare).toEqual([]);
  });

  it('should carry an images source and text through the override', function () {
    const html = docToHtml(DOC);

    expect(html).toContain('src="https://example.com/picture.png"');
    expect(html).toContain('alt="A picture"');
  });

  it('should carry no frontmatter key or value into the output', function () {
    const html = docToHtml(DOC);

    expect(html).not.toContain('odd_key');
    expect(html).not.toContain('sensitive-value');
    expect(html).not.toContain('tags');
    expect(html).not.toContain('draft');
  });

  it('should keep a table and a fenced code block intact', function () {
    const html = docToHtml(DOC);

    expect(html).toContain('<table');
    expect(html).toContain('<td');
    expect(html).toContain('<pre');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('Second');
  });

  it('should render a document with no frontmatter whole', function () {
    const html = docToHtml('# Heading\n\nProse.\n');

    expect(html).toContain('Heading');
    expect(html).toContain('Prose.');
  });
});

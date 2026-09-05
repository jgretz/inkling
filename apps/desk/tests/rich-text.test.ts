import {describe, expect, it} from 'bun:test';
import {docToHtml} from '../src/lib/rich-text.tsx';

/**
 * The HTML that goes on the clipboard. No `autoCleanup()`: this renders to a
 * string and needs no DOM.
 */

const DOC = `---
title: A piece
tags:
  - draft
odd_key: sensitive-value
---

# A piece

A paragraph with **bold** and a [link](https://example.com).

| Column | Second |
| ------ | ------ |
| one    | two    |

\`\`\`ts
const x = 1;
\`\`\`

> A quote.
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

  it('should style its elements inline', function () {
    const html = docToHtml(DOC);

    expect(html).toContain('style=');
    expect(html).toMatch(/<p style="[^"]+">/);
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

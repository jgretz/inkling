import {autoCleanup} from './setup.ts';
import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {render} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {EditorPanel} from '../src/components/editor/EditorPanel.tsx';
import type {EditMode} from '../src/lib/doc-mode.ts';

autoCleanup();

/**
 * happy-dom drops a `var()` it cannot resolve, so without these the theme's
 * font tokens would all read back as the same fallback. Sentinel family names
 * make the prose face and the code face tell themselves apart.
 */
const FONTS = ":root { --font-prose: 'Probe Serif', serif; --font-mono: 'Probe Mono', monospace; }";

const SOURCE = 'Plain *leaning* words and `code` here.\n\n```\nfenced\n```\n';

let fonts: HTMLStyleElement | undefined;

beforeEach(function () {
  fonts = document.createElement('style');
  fonts.textContent = FONTS;
  document.head.appendChild(fonts);
});

afterEach(function () {
  fonts?.remove();
  fonts = undefined;
});

function mount(editMode: EditMode = 'live', source = SOURCE) {
  const result = render(
    <EditorPanel
      editMode={editMode}
      path="drafts/a.md"
      source={source}
      onChange={function () {}}
      onSelect={function () {}}
      onSave={function () {}}
      onFocus={function () {}}
      findings={[]}
      marksOn
      reveal={undefined}
      hidden={false}
    />,
  );
  const view = EditorView.findFromDOM(result.container as HTMLElement);
  if (view === null) throw new Error('the editor view did not mount');
  return view;
}

/**
 * The element that directly holds `text`, found by what it says rather than by
 * CodeMirror's generated class names, which change with every theme edit.
 */
function holding(view: EditorView, text: string): HTMLElement {
  const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent?.includes(text) && node.parentElement !== null) {
      return node.parentElement;
    }
  }
  throw new Error(`no element in the editor holds "${text}"`);
}

function style(element: Element) {
  return getComputedStyle(element);
}

describe('the editor typography in live', function () {
  it('should set the body in the prose serif rather than monospace', function () {
    const family = style(mount().scrollDOM).fontFamily;

    expect(family).toContain('Probe Serif');
    expect(family).not.toContain('Probe Mono');
  });

  it('should keep an inline code span in monospace', function () {
    expect(style(holding(mount(), 'code')).fontFamily).toContain('Probe Mono');
  });

  it('should keep fenced code in monospace', function () {
    expect(style(holding(mount(), 'fenced')).fontFamily).toContain('Probe Mono');
  });

  it('should set a run of plain prose in the serif', function () {
    const family = style(holding(mount(), 'Plain')).fontFamily;

    expect(family).toContain('Probe Serif');
    expect(family).not.toContain('Probe Mono');
  });

  it('should set emphasis in italic', function () {
    expect(style(holding(mount(), 'leaning')).fontStyle).toBe('italic');
  });

  it('should size the body at 18px', function () {
    expect(style(mount().dom).fontSize).toBe('18px');
  });

  it('should give the body a 28px line at 18px', function () {
    expect(style(mount().scrollDOM).lineHeight).toBe('1.556');
  });

  // `.cm-content` is border-box, so its max-width is the text column plus the
  // side padding. Reading the padding back keeps this about the column.
  it('should hold the text column to the preview’s 62ch measure', function () {
    const content = style(mount().contentDOM);
    const padding = parseFloat(content.paddingLeft) + parseFloat(content.paddingRight);

    expect(content.maxWidth).toBe(`calc(62ch + ${padding}px)`);
  });
});

describe('the editor typography in source', function () {
  it('should set the body in monospace rather than the prose serif', function () {
    const family = style(mount('source').scrollDOM).fontFamily;

    expect(family).toContain('Probe Mono');
    expect(family).not.toContain('Probe Serif');
  });

  it('should size the body at 15px on a 1.7 line', function () {
    const view = mount('source');

    expect(style(view.dom).fontSize).toBe('15px');
    expect(style(view.scrollDOM).lineHeight).toBe('1.7');
  });

  it('should hold the text column to 72ch', function () {
    const content = style(mount('source').contentDOM);
    const padding = parseFloat(content.paddingLeft) + parseFloat(content.paddingRight);

    expect(content.maxWidth).toBe(`calc(72ch + ${padding}px)`);
  });
});

describe('headings in live', function () {
  const HEADINGS = 'Body first.\n\n# A title\n\n## A section';

  function lineHolding(text: string, editMode: EditMode) {
    const line = holding(mount(editMode, HEADINGS), text).closest('.cm-line');
    if (line === null) throw new Error(`no line holds "${text}"`);
    return line;
  }

  it('should set a level-one heading line with its own class', function () {
    expect(lineHolding('A title', 'live').classList.contains('cm-live-h1')).toBe(true);
  });

  it('should set a level-two heading line with its own class', function () {
    expect(lineHolding('A section', 'live').classList.contains('cm-live-h2')).toBe(true);
  });

  it('should leave heading lines unclassed in source', function () {
    expect(lineHolding('A title', 'source').classList.contains('cm-live-h1')).toBe(false);
  });
});

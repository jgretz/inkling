import {EditorView} from '@codemirror/view';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import type {Extension} from '@codemirror/state';

/**
 * The editor's look. It deliberately does not resemble a code editor: markdown
 * syntax is dimmed rather than coloured, so the eye lands on the prose and the
 * markers stay legible without competing with it.
 */
const paint = EditorView.theme(
  {
    '&': {
      color: 'var(--color-ink-100)',
      backgroundColor: 'var(--color-ink-900)',
      height: '100%',
      fontSize: '15px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.7',
      padding: '2rem 0',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: 'var(--color-accent)',
      maxWidth: '72ch',
      margin: '0 auto',
      padding: '0 1.5rem',
    },
    '.cm-line': {padding: '0'},
    '.cm-cursor, .cm-dropCursor': {borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px'},
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--color-ink-700)',
    },
    '.cm-activeLine': {backgroundColor: 'transparent'},
    '.cm-gutters': {display: 'none'},
    '&.cm-focused': {outline: 'none'},
  },
  {dark: true},
);

const highlight = HighlightStyle.define([
  {tag: tags.heading1, fontSize: '1.5em', fontWeight: '600', color: 'var(--color-ink-50)'},
  {tag: tags.heading2, fontSize: '1.25em', fontWeight: '600', color: 'var(--color-ink-50)'},
  {tag: [tags.heading3, tags.heading4], fontWeight: '600', color: 'var(--color-ink-50)'},
  {tag: tags.strong, fontWeight: '700', color: 'var(--color-ink-50)'},
  {tag: tags.emphasis, fontStyle: 'italic', color: 'var(--color-ink-100)'},
  {tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--color-ink-400)'},
  {tag: tags.link, color: 'var(--color-accent)'},
  {tag: tags.url, color: 'var(--color-accent-muted)'},
  {tag: tags.quote, color: 'var(--color-ink-300)', fontStyle: 'italic'},
  {tag: [tags.monospace, tags.content], color: 'var(--color-ink-200)'},
  // The syntax characters themselves: present, but out of the way.
  {tag: [tags.processingInstruction, tags.meta, tags.punctuation], color: 'var(--color-ink-600)'},
]);

export const inklingTheme: Extension = [paint, syntaxHighlighting(highlight)];

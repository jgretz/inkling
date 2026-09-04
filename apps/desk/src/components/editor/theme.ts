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

    // A voice finding: an underline and nothing else. `text-decoration-line`
    // rather than `border-bottom` so it wraps with the text across a line break,
    // and nothing here touches metrics, so marking a run cannot reflow the
    // paragraph a writer is typing into.
    '.cm-voice-finding': {
      textDecorationLine: 'underline',
      textDecorationStyle: 'solid',
      textDecorationColor: 'var(--color-voice-mark)',
      textDecorationThickness: '1px',
      textUnderlineOffset: '3px',
      textDecorationSkipInk: 'auto',
    },
    '.cm-voice-finding:hover': {textDecorationColor: 'var(--color-voice-mark-strong)'},

    '.cm-tooltip, .cm-tooltip-hover': {
      backgroundColor: 'var(--color-ink-850)',
      border: '1px solid var(--color-ink-700)',
      borderRadius: '6px',
      color: 'var(--color-ink-200)',
    },
    '.cm-voice-tooltip': {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      maxWidth: '28rem',
      padding: '0.5rem 0.625rem',
      fontFamily: 'var(--font-ui)',
      fontSize: '12px',
      lineHeight: '1.45',
    },
    '.cm-voice-tooltip-rule': {color: 'var(--color-ink-400)'},
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

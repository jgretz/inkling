import {createElement} from 'react';
import type {CSSProperties, HTMLAttributes, ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseDoc} from '@inkling/vault';
import {DocMarkdown, type Components} from '../components/preview/DocMarkdown.tsx';

/**
 * The document as HTML a mail client will keep.
 *
 * Pure: no filesystem, no window, no clipboard. It renders the same
 * `DocMarkdown` the preview does, so the two can never disagree about what the
 * markdown means, and differs only in that every element is styled inline.
 * Mail clients drop a stylesheet and keep a `style` attribute, so a class name
 * would arrive as unstyled text.
 */

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const RULE = '1px solid #d0d0d0';
const WASH = '#f4f4f5';

/** The wrapper every override inherits from, so no element repeats the basics. */
const BASE: CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  fontSize: '15px',
  lineHeight: 1.6,
  color: '#1a1a1a',
};

const STYLES = {
  h1: {fontSize: '1.6em', fontWeight: 600, lineHeight: 1.25, margin: '1.2em 0 0.5em'},
  h2: {fontSize: '1.35em', fontWeight: 600, lineHeight: 1.3, margin: '1.2em 0 0.5em'},
  h3: {fontSize: '1.15em', fontWeight: 600, margin: '1.2em 0 0.4em'},
  h4: {fontSize: '1em', fontWeight: 600, margin: '1.2em 0 0.4em'},
  p: {margin: '0 0 1em'},
  a: {color: '#0b5fff', textDecoration: 'underline'},
  strong: {fontWeight: 600},
  em: {fontStyle: 'italic'},
  ul: {margin: '0 0 1em', paddingLeft: '1.5em'},
  ol: {margin: '0 0 1em', paddingLeft: '1.5em'},
  li: {margin: '0 0 0.25em'},
  blockquote: {
    margin: '0 0 1em',
    padding: '0 0 0 1em',
    borderLeft: '3px solid #d0d0d0',
    color: '#555555',
  },
  code: {
    fontFamily: MONO,
    fontSize: '0.9em',
    backgroundColor: WASH,
    padding: '0.1em 0.3em',
    borderRadius: '3px',
  },
  pre: {
    fontFamily: MONO,
    fontSize: '0.9em',
    backgroundColor: WASH,
    padding: '0.75em',
    borderRadius: '4px',
    margin: '0 0 1em',
    overflowX: 'auto',
  },
  table: {borderCollapse: 'collapse', width: '100%', margin: '0 0 1em'},
  thead: {backgroundColor: WASH},
  // Nothing to style, listed anyway: an entry here is also what strips the
  // class names and the renderer's own props off an element.
  tbody: {},
  tr: {},
  th: {border: RULE, padding: '0.4em 0.6em', textAlign: 'left', fontWeight: 600},
  td: {border: RULE, padding: '0.4em 0.6em'},
  hr: {border: 'none', borderTop: RULE, margin: '1.5em 0'},
  img: {maxWidth: '100%'},
} as const satisfies Record<string, CSSProperties>;

/** What the renderer hands an override on top of the element's own props. */
type ExtraProps = {node?: unknown};

type OverrideProps = HTMLAttributes<HTMLElement> & ExtraProps;

/**
 * One element, styled inline and stripped of everything the app's own CSS owns.
 *
 * `className` is dropped rather than merged: the renderer puts `language-ts` on
 * a fenced block's `<code>`, and a class name a mail client cannot resolve is
 * noise at best. `node` is the mdast node the renderer passes alongside the
 * props, and it is not a DOM attribute.
 */
function styled(tag: string, style: CSSProperties) {
  return function Styled({node, className, ...rest}: OverrideProps): ReactElement {
    return createElement(tag, {...rest, style});
  };
}

/** An override per element a draft actually contains. */
export const MAIL_COMPONENTS: Components = Object.fromEntries(
  Object.entries(STYLES).map(function ([tag, style]): [string, Components[keyof Components]] {
    return [tag, styled(tag, style)];
  }),
);

/**
 * The document's body as standalone, inline-styled HTML.
 *
 * The frontmatter is parsed off with `parseDoc` rather than matched away, which
 * is what guarantees no metadata key reaches the clipboard.
 */
export function docToHtml(source: string): string {
  return renderToStaticMarkup(
    <div style={BASE}>
      <DocMarkdown body={parseDoc(source).body} components={MAIL_COMPONENTS} />
    </div>,
  );
}

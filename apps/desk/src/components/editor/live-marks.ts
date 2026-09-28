import {StateField, type EditorState, type Extension, type Range} from '@codemirror/state';
import {Decoration, EditorView, type DecorationSet} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type Span = {from: number; to: number};

/** Named through the tree rather than imported: `@lezer/common` is not a direct dependency. */
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/**
 * What Live does to a document, as plain data: the marker ranges it hides, the
 * heading lines it sets at size, and the link text it colours.
 *
 * Only `hidden` depends on the selection. Headings and links are styled on every
 * line, so a heading does not change size when the caret enters it.
 */
export type LiveMarkup = {
  hidden: Span[];
  headings: {from: number; level: HeadingLevel}[];
  links: Span[];
};

const HEADING = /^ATXHeading([1-6])$/;

/** Inline nodes whose every mark child of this name is hidden. */
const PAIRED_MARKS: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark',
};

/**
 * The opening `#` run plus the space after it, and a closing `#` run plus the
 * whitespace before it.
 */
function headingHides(state: EditorState, node: SyntaxNode): Span[] {
  const [open, close] = node.getChildren('HeaderMark');
  if (open === undefined) return [];
  const text = state.doc;
  const openEnd = text.sliceString(open.to, open.to + 1) === ' ' ? open.to + 1 : open.to;
  const spans: Span[] = [{from: open.from, to: openEnd}];
  if (close !== undefined) {
    let from = close.from;
    while (from > openEnd && /[ \t]/.test(text.sliceString(from - 1, from))) from -= 1;
    spans.push({from: Math.max(from, openEnd), to: close.to});
  }
  return spans;
}

/**
 * `[` and everything from `]` to the end, for an inline link with a URL.
 *
 * A reference link has no `URL` child and an empty text would leave nothing on
 * screen to click into, so both stay raw. So does a link written across two
 * lines: hiding it would join the lines on screen while the caret rule still
 * reasons about them one at a time.
 */
function linkParts(state: EditorState, node: SyntaxNode): {hidden: Span[]; text: Span} | undefined {
  if (node.getChild('URL') === null) return undefined;
  if (state.doc.sliceString(node.from, node.to).includes('\n')) return undefined;
  const [open, close] = node.getChildren('LinkMark');
  if (open === undefined || close === undefined || close.from <= open.to) return undefined;
  return {
    hidden: [
      {from: open.from, to: open.to},
      {from: close.from, to: node.to},
    ],
    text: {from: open.to, to: close.from},
  };
}

/**
 * Every line number any selection range touches, an empty caret included, and
 * every line between a range's two ends.
 */
function touchedLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

/**
 * Live's markup for `state`, read off the markdown syntax tree.
 */
export function liveMarkup(state: EditorState): LiveMarkup {
  const candidates: Span[] = [];
  const headings: LiveMarkup['headings'] = [];
  const links: Span[] = [];

  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name === 'Image') return false;
      const heading = HEADING.exec(ref.name);
      if (heading !== null) {
        // The line's start rather than the node's: a heading inside a quote or a
        // list item starts mid-line, and a line decoration belongs at column 0.
        headings.push({
          from: state.doc.lineAt(ref.from).from,
          level: Number(heading[1]) as HeadingLevel,
        });
        candidates.push(...headingHides(state, ref.node));
        return;
      }
      const mark = PAIRED_MARKS[ref.name];
      if (mark !== undefined) {
        for (const child of ref.node.getChildren(mark)) {
          candidates.push({from: child.from, to: child.to});
        }
        return;
      }
      if (ref.name === 'Link') {
        const parts = linkParts(state, ref.node);
        if (parts === undefined) return;
        candidates.push(...parts.hidden);
        links.push(parts.text);
      }
    },
  });

  const touched = touchedLines(state);
  const hidden = candidates.filter(function ({from, to}) {
    if (to <= from) return false;
    return !touched.has(state.doc.lineAt(from).number);
  });

  return {hidden, headings, links};
}

const hide = Decoration.replace({});
const link = Decoration.mark({class: 'cm-live-link'});
const HEADING_LINES: Record<HeadingLevel, Decoration> = {
  1: Decoration.line({class: 'cm-live-h1'}),
  2: Decoration.line({class: 'cm-live-h2'}),
  3: Decoration.line({class: 'cm-live-h3'}),
  4: Decoration.line({class: 'cm-live-h4'}),
  5: Decoration.line({class: 'cm-live-h5'}),
  6: Decoration.line({class: 'cm-live-h6'}),
};

/** `liveMarkup` as one sorted decoration set. */
export function liveDecorations(state: EditorState): DecorationSet {
  const {hidden, headings, links} = liveMarkup(state);
  const ranges: Range<Decoration>[] = [
    ...hidden.map(function ({from, to}) {
      return hide.range(from, to);
    }),
    ...headings.map(function ({from, level}) {
      return HEADING_LINES[level].range(from);
    }),
    ...links.map(function ({from, to}) {
      return link.range(from, to);
    }),
  ];
  return Decoration.set(ranges, true);
}

/**
 * Recomputed on every edit and selection change, and whenever the parser hands
 * back more of the tree, which a long document gets in the background after the
 * first transaction.
 */
const liveField = StateField.define<DecorationSet>({
  create: liveDecorations,
  update(decorations, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return liveDecorations(tr.state);
    }
    return decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** Live mode: markdown markers hidden on every line the selection does not touch. */
export function liveMarks(): Extension {
  return liveField;
}

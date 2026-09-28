import {StateField, type EditorState, type Extension, type Range} from '@codemirror/state';
import {Decoration, EditorView, type DecorationSet} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import {foldField, frontmatterField} from './frontmatter-fold.ts';
import {RuleWidget, TaskBox, taskClicks} from './live-widgets.ts';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type Span = {from: number; to: number};

/** Named through the tree rather than imported: `@lezer/common` is not a direct dependency. */
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/**
 * What Live does to a document, as plain data: the marker ranges it hides, the
 * heading lines it sets at size, the link text it colours, the task markers it
 * draws as checkboxes, the thematic breaks it draws as rules, the quote lines it
 * rules down the side, and the list lines it gives a hanging indent.
 *
 * Only `hidden`, `tasks` and `rules` depend on the selection: each is left raw
 * on a line the selection touches. Everything else is styled on every line, so
 * a heading does not change size and a list item does not shift when the caret
 * enters it.
 */
export type LiveMarkup = {
  hidden: Span[];
  headings: {from: number; level: HeadingLevel}[];
  links: Span[];
  tasks: (Span & {checked: boolean})[];
  rules: Span[];
  /** Line starts. */
  quoteLines: number[];
  /** A line start, and the width of its list marker plus the space after it in characters. */
  listIndents: {from: number; indent: number}[];
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
  const taskCandidates: LiveMarkup['tasks'] = [];
  const ruleCandidates: Span[] = [];
  const quoteLines = new Set<number>();
  const listIndents = new Map<number, number>();
  const bodyFrom = state.field(frontmatterField).span?.to ?? 0;

  syntaxTree(state).iterate({
    enter(ref) {
      // The parser reads a frontmatter block as markdown: its fences as rules,
      // its tag list as a list. None of it is prose, so none of it is drawn.
      if (ref.name !== 'Document' && ref.from < bodyFrom) return false;
      if (ref.name === 'Image') return false;
      if (ref.name === 'TaskMarker') {
        const checked = state.sliceDoc(ref.from + 1, ref.from + 2) !== ' ';
        taskCandidates.push({from: ref.from, to: ref.to, checked});
        return;
      }
      if (ref.name === 'HorizontalRule') {
        ruleCandidates.push({from: ref.from, to: ref.to});
        return;
      }
      if (ref.name === 'Blockquote') {
        const last = state.doc.lineAt(ref.to).number;
        for (let line = state.doc.lineAt(ref.from).number; line <= last; line += 1) {
          quoteLines.add(state.doc.line(line).from);
        }
        return;
      }
      if (ref.name === 'ListMark') {
        // Keyed by line so a nested list opened on its parent's line (`- - a`)
        // leaves one indent, the inner one, which the tree visits last.
        const line = state.doc.lineAt(ref.from);
        listIndents.set(line.from, ref.to - line.from + 1);
        return;
      }
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
  function untouched({from}: Span): boolean {
    return !touched.has(state.doc.lineAt(from).number);
  }
  const hidden = candidates.filter(function (span) {
    return span.to > span.from && untouched(span);
  });

  return {
    hidden,
    headings,
    links,
    tasks: taskCandidates.filter(untouched),
    rules: ruleCandidates.filter(untouched),
    quoteLines: [...quoteLines],
    listIndents: [...listIndents].map(function ([from, indent]) {
      return {from, indent};
    }),
  };
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

const TASK_BOXES = {
  checked: Decoration.replace({widget: new TaskBox(true)}),
  unchecked: Decoration.replace({widget: new TaskBox(false)}),
};
const rule = Decoration.replace({widget: new RuleWidget()});
const quote = Decoration.line({class: 'cm-live-quote'});

/** `liveMarkup` as one sorted decoration set. */
export function liveDecorations(state: EditorState): DecorationSet {
  const {hidden, headings, links, tasks, rules, quoteLines, listIndents} = liveMarkup(state);
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
    ...tasks.map(function ({from, to, checked}) {
      return (checked ? TASK_BOXES.checked : TASK_BOXES.unchecked).range(from, to);
    }),
    ...rules.map(function ({from, to}) {
      return rule.range(from, to);
    }),
    ...quoteLines.map(function (from) {
      return quote.range(from);
    }),
    ...listIndents.map(function ({from, indent}) {
      return Decoration.line({
        attributes: {class: 'cm-live-list', style: `--live-indent: ${indent}ch`},
      }).range(from);
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

/**
 * Live mode: markdown markers hidden and block markup drawn on every line the
 * selection does not touch, and the frontmatter folded into its tags until the
 * selection enters it.
 */
export function liveMarks(): Extension {
  return [frontmatterField, foldField, liveField, taskClicks];
}

import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';

/** Named through the tree rather than imported: `@lezer/common` is not a direct dependency. */
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

export type InlineKind = 'bold' | 'italic' | 'strikethrough' | 'code';

type InlineMark = {
  /** The syntax node the construct parses as. */
  node: string;
  /** Its delimiter children, which unwrapping deletes. */
  mark: string;
  /** What wrapping writes on either side. */
  delim: string;
};

export const INLINE: Record<InlineKind, InlineMark> = {
  bold: {node: 'StrongEmphasis', mark: 'EmphasisMark', delim: '**'},
  italic: {node: 'Emphasis', mark: 'EmphasisMark', delim: '_'},
  strikethrough: {node: 'Strikethrough', mark: 'StrikethroughMark', delim: '~~'},
  code: {node: 'InlineCode', mark: 'CodeMark', delim: '`'},
};

/**
 * The innermost `name` node holding all of `[from, to]`, or `null`.
 *
 * Tried from both sides of `from`, so a caret against either edge of the
 * construct counts as inside it.
 */
export function enclosing(
  state: EditorState,
  from: number,
  to: number,
  name: string,
): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(from, side);
      node !== null;
      node = node.parent
    ) {
      if (node.name === name && node.from <= from && to <= node.to) return node;
    }
  }
  return null;
}

/** `[from, to]` with surrounding whitespace dropped, or `null` when nothing else is left. */
function trimmed(state: EditorState, from: number, to: number): {from: number; to: number} | null {
  const text = state.sliceDoc(from, to);
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  if (end <= start) return null;
  return {from: from + start, to: from + end};
}

/** A range over `[from, to]` facing the way `like` does. */
function facing(like: SelectionRange, from: number, to: number): SelectionRange {
  return like.anchor > like.head
    ? EditorSelection.range(to, from)
    : EditorSelection.range(from, to);
}

function toggleRange(state: EditorState, range: SelectionRange, {node, mark, delim}: InlineMark) {
  const inside = enclosing(state, range.from, range.to, node);
  if (inside !== null) {
    const changes = state.changes(
      inside.getChildren(mark).map(function (child) {
        return {from: child.from, to: child.to};
      }),
    );
    return {
      changes,
      range: EditorSelection.range(changes.mapPos(range.anchor), changes.mapPos(range.head)),
    };
  }

  const size = delim.length;
  const {head} = range;
  if (
    range.empty &&
    state.sliceDoc(head - size, head) === delim &&
    state.sliceDoc(head, head + size) === delim
  ) {
    return {
      changes: {from: head - size, to: head + size},
      range: EditorSelection.cursor(head - size),
    };
  }

  const text = range.empty ? null : trimmed(state, range.from, range.to);
  if (text !== null) {
    return {
      changes: [
        {from: text.from, insert: delim},
        {from: text.to, insert: delim},
      ],
      range: facing(range, text.from + size, text.to + size),
    };
  }

  const word = state.wordAt(head);
  if (word !== null) {
    return {
      changes: [
        {from: word.from, insert: delim},
        {from: word.to, insert: delim},
      ],
      range: EditorSelection.cursor(head + size),
    };
  }

  return {changes: {from: head, insert: delim + delim}, range: EditorSelection.cursor(head + size)};
}

/**
 * Wraps each selection range in `kind`'s delimiters, or unwraps the construct it
 * sits in. Only the construct's own delimiters are deleted, so bold inside
 * `***x***` leaves `*x*`.
 */
export function toggleInline(state: EditorState, kind: InlineKind): TransactionSpec {
  return state.changeByRange(function (range) {
    return toggleRange(state, range, INLINE[kind]);
  });
}

/** A link's URL, or where one would be typed when it has none. */
function urlSlot(state: EditorState, link: SyntaxNode): SelectionRange | null {
  const url = link.getChild('URL');
  if (url !== null) return EditorSelection.range(url.from, url.to);
  const open = link.getChildren('LinkMark').find(function (child) {
    return state.sliceDoc(child.from, child.to) === '(';
  });
  return open === undefined ? null : EditorSelection.cursor(open.to);
}

function linkRange(state: EditorState, range: SelectionRange) {
  const link = enclosing(state, range.from, range.to, 'Link');
  if (link !== null) return {range: urlSlot(state, link) ?? range};

  const text =
    (range.empty ? null : trimmed(state, range.from, range.to)) ?? state.wordAt(range.head);
  if (text === null) {
    return {
      changes: {from: range.head, insert: '[]()'},
      range: EditorSelection.cursor(range.head + 1),
    };
  }
  return {
    changes: [
      {from: text.from, insert: '['},
      {from: text.to, insert: ']()'},
    ],
    range: EditorSelection.cursor(text.to + 3),
  };
}

/**
 * Turns each selection range, or the word under a caret, into `[text]()` with the
 * caret where the URL goes. Inside a link it edits nothing and selects the URL.
 */
export function toggleLink(state: EditorState): TransactionSpec {
  return state.changeByRange(function (range) {
    return linkRange(state, range);
  });
}

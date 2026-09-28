import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type TransactionSpec,
} from '@codemirror/state';

export type LineFormat = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'task' | 'quote';

type BlockFormat = Exclude<LineFormat, 'quote'>;

/**
 * One line's leading markup, as offsets into the line.
 *
 * `quote` is the end of the `>` prefix, zero when there is none. `marker` spans
 * the block marker, and is empty at the end of the indent when the line has none.
 */
export type ParsedLine = {
  quote: number;
  marker: {from: number; to: number};
  /** The format the marker is, or `null` when the line has no marker. */
  format: BlockFormat | null;
  /** Whether nothing follows the quote prefix, the indent and the marker. */
  empty: boolean;
};

/** One quote level, the indent, then the first block marker that matches, a task before a bullet. */
const LINE =
  /^( {0,3}> ?)?[ \t]*(?:(?<task>[-*+][ \t]+\[[ xX]\][ \t]+)|(?<bullet>[-*+][ \t]+)|(?<numbered>\d{1,9}[.)][ \t]+)|(?<heading>#{1,6}[ \t]+))?/;

const HEADING_LEVEL: Record<number, BlockFormat | undefined> = {1: 'h1', 2: 'h2', 3: 'h3'};

function markerFormat(groups: Record<string, string | undefined>): BlockFormat | null {
  if (groups.task !== undefined) return 'task';
  if (groups.bullet !== undefined) return 'bullet';
  if (groups.numbered !== undefined) return 'numbered';
  if (groups.heading !== undefined) {
    // Levels 4 to 6 are no format the toolbar sets, though their marker is
    // still the one a new format replaces.
    return HEADING_LEVEL[groups.heading.trimEnd().length] ?? null;
  }
  return null;
}

export function parseLine(text: string): ParsedLine {
  const match = LINE.exec(text);
  const groups = match?.groups ?? {};
  const markerText = groups.task ?? groups.bullet ?? groups.numbered ?? groups.heading ?? '';
  const end = match?.[0].length ?? 0;
  return {
    quote: match?.[1]?.length ?? 0,
    marker: {from: end - markerText.length, to: end},
    format: markerFormat(groups),
    empty: text.slice(end).trim() === '',
  };
}

/**
 * Every line a selection range covers, in order. A range that ends at the start
 * of a later line stops on the line before it, which is how a whole line
 * selected by dragging to the next one reads.
 */
export function touchedLines(state: EditorState): Line[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    let last = state.doc.lineAt(range.to);
    if (range.to > range.from && range.to === last.from && last.number !== first.number) {
      last = state.doc.line(last.number - 1);
    }
    for (let n = first.number; n <= last.number; n += 1) numbers.add(n);
  }
  return [...numbers]
    .sort(function (a, b) {
      return a - b;
    })
    .map(function (n) {
      return state.doc.line(n);
    });
}

/**
 * The lines `format` applies to. A quote takes every line, so a quote over two
 * paragraphs stays one block; a heading or a list skips the blank lines between
 * paragraphs unless the blank line is all there is.
 */
function targetLines(state: EditorState, format: LineFormat): {line: Line; parsed: ParsedLine}[] {
  const lines = touchedLines(state).map(function (line) {
    return {line, parsed: parseLine(line.text)};
  });
  if (format === 'quote' || lines.length === 1) return lines;
  return lines.filter(function ({parsed}) {
    return parsed.marker.to > parsed.marker.from || !parsed.empty;
  });
}

function carries(parsed: ParsedLine, format: LineFormat): boolean {
  return format === 'quote' ? parsed.quote > 0 : parsed.format === format;
}

/** Whether every line `format` would apply to already has it, so toggling removes it. */
export function linesCarry(state: EditorState, format: LineFormat): boolean {
  const lines = targetLines(state, format);
  return (
    lines.length > 0 &&
    lines.every(function ({parsed}) {
      return carries(parsed, format);
    })
  );
}

const MARKERS: Record<Exclude<BlockFormat, 'numbered'>, string> = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  bullet: '- ',
  task: '- [ ] ',
};

function quoteChanges(lines: {line: Line; parsed: ParsedLine}[], remove: boolean): ChangeSpec[] {
  if (remove) {
    return lines.map(function ({line, parsed}) {
      const mark = line.text.indexOf('>');
      return {from: line.from + mark, to: line.from + parsed.quote};
    });
  }
  return lines
    .filter(function ({parsed}) {
      return parsed.quote === 0;
    })
    .map(function ({line}) {
      return {from: line.from, insert: line.text.trim() === '' ? '>' : '> '};
    });
}

function blockChanges(
  lines: {line: Line; parsed: ParsedLine}[],
  format: BlockFormat,
  remove: boolean,
): ChangeSpec[] {
  return lines.flatMap(function ({line, parsed}, index) {
    const from = line.from + parsed.marker.from;
    const to = line.from + parsed.marker.to;
    const insert = remove ? '' : format === 'numbered' ? `${index + 1}. ` : MARKERS[format];
    if (line.text.slice(parsed.marker.from, parsed.marker.to) === insert) return [];
    return [{from, to, insert}];
  });
}

/**
 * Sets `format` on every line the selection touches, replacing whatever heading
 * or list marker a line had, or removes it when every line already carries it.
 * Numbered lines are numbered from 1 across the lines being set, and nowhere
 * else. `null` when there is no line to apply it to.
 */
export function toggleLines(state: EditorState, format: LineFormat): TransactionSpec | null {
  const lines = targetLines(state, format);
  if (lines.length === 0) return null;
  const remove = lines.every(function ({parsed}) {
    return carries(parsed, format);
  });
  const changes = state.changes(
    format === 'quote' ? quoteChanges(lines, remove) : blockChanges(lines, format, remove),
  );
  const ranges = state.selection.ranges.map(function (range) {
    return EditorSelection.range(changes.mapPos(range.anchor, 1), changes.mapPos(range.head, 1));
  });
  return {changes, selection: EditorSelection.create(ranges, state.selection.mainIndex)};
}

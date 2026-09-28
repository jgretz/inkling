import type {EditorState, Extension, TransactionSpec} from '@codemirror/state';
import {keymap, type EditorView, type KeyBinding} from '@codemirror/view';
import {isolateHistory} from '@codemirror/commands';
import {enclosing, INLINE, toggleInline, toggleLink, type InlineKind} from './format-inline.ts';
import {linesCarry, toggleLines, type LineFormat} from './format-lines.ts';

export const FORMAT_NAMES = [
  'bold',
  'italic',
  'strikethrough',
  'code',
  'link',
  'h1',
  'h2',
  'h3',
  'bullet',
  'numbered',
  'task',
  'quote',
] as const;

export type FormatName = (typeof FORMAT_NAMES)[number];

/** A format as a pure transform: the transaction it makes, or `null` for nothing to do. */
export type FormatCommand = (state: EditorState) => TransactionSpec | null;

function isInline(name: FormatName): name is InlineKind {
  return Object.hasOwn(INLINE, name);
}

function inline(kind: InlineKind): FormatCommand {
  return function (state) {
    return toggleInline(state, kind);
  };
}

function lines(format: LineFormat): FormatCommand {
  return function (state) {
    return toggleLines(state, format);
  };
}

/**
 * `raw` made its own undo step.
 *
 * One transaction is not enough for that: history joins typing into the event
 * before it when the two are adjacent and close in time, so a word typed
 * straight after Command-B would undo together with the bold. `isolateHistory`
 * closes the format's event on both sides.
 */
function isolated(raw: FormatCommand): FormatCommand {
  return function (state) {
    const spec = raw(state);
    if (spec === null) return null;
    return {
      ...spec,
      userEvent: 'input.format',
      annotations: isolateHistory.of('full'),
      scrollIntoView: true,
    };
  };
}

export const FORMAT_COMMANDS: Record<FormatName, FormatCommand> = {
  bold: isolated(inline('bold')),
  italic: isolated(inline('italic')),
  strikethrough: isolated(inline('strikethrough')),
  code: isolated(inline('code')),
  link: isolated(toggleLink),
  h1: isolated(lines('h1')),
  h2: isolated(lines('h2')),
  h3: isolated(lines('h3')),
  bullet: isolated(lines('bullet')),
  numbered: isolated(lines('numbered')),
  task: isolated(lines('task')),
  quote: isolated(lines('quote')),
};

export const FORMAT_KEYS: Partial<Record<FormatName, string>> = {
  bold: 'Mod-b',
  italic: 'Mod-i',
  link: 'Mod-k',
  strikethrough: 'Mod-Shift-x',
  code: 'Mod-Shift-c',
};

/**
 * The formats the selection is in: an inline mark or a link around the main
 * range, and a line format every touched line carries. A format here is one its
 * command would remove.
 */
export function activeFormats(state: EditorState): ReadonlySet<FormatName> {
  const {from, to} = state.selection.main;
  return new Set(
    FORMAT_NAMES.filter(function (name) {
      if (name === 'link') return enclosing(state, from, to, 'Link') !== null;
      if (isInline(name)) return enclosing(state, from, to, INLINE[name].node) !== null;
      return linesCarry(state, name);
    }),
  );
}

export function sameFormats(a: ReadonlySet<FormatName>, b: ReadonlySet<FormatName>): boolean {
  if (a.size !== b.size) return false;
  for (const name of a) if (!b.has(name)) return false;
  return true;
}

/** Runs `name` on `view`. Always `true`, so a bound key is spent even when there is nothing to do. */
export function runFormat(view: EditorView, name: FormatName): boolean {
  const spec = FORMAT_COMMANDS[name](view.state);
  if (spec !== null) view.dispatch(spec);
  return true;
}

/**
 * The format keys. Must come before the default keymap, which binds Mod-i to
 * `selectParentSyntax` and would otherwise take it.
 */
export function formatKeymap(): Extension {
  return keymap.of(
    FORMAT_NAMES.flatMap(function (name): KeyBinding[] {
      const key = FORMAT_KEYS[name];
      if (key === undefined) return [];
      return [
        {
          key,
          preventDefault: true,
          run(view) {
            return runFormat(view, name);
          },
        },
      ];
    }),
  );
}

import {Fragment} from 'react';
import Bold from 'lucide-react/dist/esm/icons/bold';
import Code from 'lucide-react/dist/esm/icons/code';
import Heading1 from 'lucide-react/dist/esm/icons/heading-1';
import Heading2 from 'lucide-react/dist/esm/icons/heading-2';
import Heading3 from 'lucide-react/dist/esm/icons/heading-3';
import Italic from 'lucide-react/dist/esm/icons/italic';
import Link from 'lucide-react/dist/esm/icons/link';
import List from 'lucide-react/dist/esm/icons/list';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered';
import ListTodo from 'lucide-react/dist/esm/icons/list-todo';
import Strikethrough from 'lucide-react/dist/esm/icons/strikethrough';
import TextQuote from 'lucide-react/dist/esm/icons/text-quote';
import {FORMAT_KEYS, type FormatName} from '../editor/format.ts';
import {Toggle} from '../shell/Toggle.tsx';

const BUTTONS: Record<FormatName, {label: string; Icon: typeof Bold}> = {
  bold: {label: 'Bold', Icon: Bold},
  italic: {label: 'Italic', Icon: Italic},
  strikethrough: {label: 'Strikethrough', Icon: Strikethrough},
  code: {label: 'Inline code', Icon: Code},
  link: {label: 'Link', Icon: Link},
  h1: {label: 'Heading 1', Icon: Heading1},
  h2: {label: 'Heading 2', Icon: Heading2},
  h3: {label: 'Heading 3', Icon: Heading3},
  bullet: {label: 'Bulleted list', Icon: List},
  numbered: {label: 'Numbered list', Icon: ListOrdered},
  task: {label: 'Task', Icon: ListTodo},
  quote: {label: 'Quote', Icon: TextQuote},
};

const GROUPS: readonly (readonly FormatName[])[] = [
  ['bold', 'italic', 'strikethrough', 'code', 'link'],
  ['h1', 'h2', 'h3'],
  ['bullet', 'numbered', 'task', 'quote'],
];

const KEY_SYMBOLS: Record<string, string> = {Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃'};

/** A CodeMirror key name as the Mac menu writes it: `Mod-Shift-x` is `⌘⇧X`. */
function keyHint(key: string): string {
  return key
    .split('-')
    .map(function (part) {
      return KEY_SYMBOLS[part] ?? part.toUpperCase();
    })
    .join('');
}

function hintFor(name: FormatName): string {
  const {label} = BUTTONS[name];
  const key = FORMAT_KEYS[name];
  return key === undefined ? label : `${label} (${keyHint(key)})`;
}

type FormatToolbarProps = {
  active: ReadonlySet<FormatName>;
  onFormat: (name: FormatName) => void;
};

/**
 * The formatting buttons, for the left of the document bar.
 *
 * Clipped rather than wrapped when the column is too narrow for all twelve, so
 * the bar keeps its height and the mode switch stays where it is.
 */
export function FormatToolbar({active, onFormat}: FormatToolbarProps) {
  return (
    <div
      role="group"
      aria-label="Formatting"
      className="flex min-w-0 items-center gap-0.5 overflow-hidden"
    >
      {GROUPS.map(function (group, index) {
        return (
          <Fragment key={group[0]}>
            {index > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-ink-700" />}
            {group.map(function (name) {
              const {label, Icon} = BUTTONS[name];
              return (
                <Toggle
                  key={name}
                  active={active.has(name)}
                  label={label}
                  hint={hintFor(name)}
                  holdFocus
                  onClick={function () {
                    onFormat(name);
                  }}
                >
                  <Icon size={15} />
                </Toggle>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The modes the document panel can edit in: Live, the markdown with its markers
 * hidden off the caret's lines, and Source, the markdown as typed.
 *
 * Data rather than a union written out, so the next mode is one more member
 * here and every guard below learns it for free.
 */
export const EDIT_MODES = ['live', 'source'] as const;

export type EditMode = (typeof EDIT_MODES)[number];

/** Every way the panel can show one document, in the title bar's order. */
export const DOC_MODES = [...EDIT_MODES, 'read'] as const;

export type DocMode = (typeof DOC_MODES)[number];

export function isDocMode(value: unknown): value is DocMode {
  return (DOC_MODES as readonly unknown[]).includes(value);
}

export function isEditMode(value: unknown): value is EditMode {
  return (EDIT_MODES as readonly unknown[]).includes(value);
}

/**
 * The mode on screen, and the editing mode Read returns to.
 *
 * One invariant: outside Read the two agree, so `editMode` is always the last
 * editing mode the writer was in. Every transition below keeps it.
 */
export type ModeState = {docMode: DocMode; editMode: EditMode};

/** The mode the writer picked. Read keeps the editing mode to return to. */
export function showMode(state: ModeState, mode: DocMode): ModeState {
  return mode === 'read' ? {...state, docMode: mode} : {docMode: mode, editMode: mode};
}

/** Read from an editing mode, and the last editing mode from Read. */
export function toggleRead(state: ModeState): ModeState {
  return showMode(state, state.docMode === 'read' ? state.editMode : 'read');
}

/**
 * The last editing mode if the panel is in Read, and the state unchanged
 * otherwise.
 *
 * What revealing a range asks for: a selection is only visible in the editor,
 * and a writer already editing should stay in whichever editing mode they chose.
 */
export function leaveRead(state: ModeState): ModeState {
  return state.docMode === 'read' ? showMode(state, state.editMode) : state;
}

/** The other editing mode, from either editing mode or from Read. */
export function toggleEditMode(state: ModeState): ModeState {
  return showMode(state, state.editMode === 'live' ? 'source' : 'live');
}

type KeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/**
 * Command-E, and nothing else that shares its letter.
 *
 * Control is ruled out by name because CodeMirror binds Ctrl-E to end of line
 * on the Mac, and a writer using it must not be thrown out of the editor.
 * inkling is macOS only, so Mod is Command.
 */
export function isToggleReadKey(event: KeyEvent): boolean {
  return event.key === 'e' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

/**
 * Command-Shift-E. The key is compared lowercased because WebKit may report
 * `'E'` while Shift is held.
 */
export function isToggleEditKey(event: KeyEvent): boolean {
  return (
    event.key.toLowerCase() === 'e' &&
    event.metaKey &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

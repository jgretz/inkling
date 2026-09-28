/**
 * The ways the document panel can show one document.
 *
 * Data rather than a union written out, so the next mode is one more member
 * here and every guard below learns it for free.
 */
export const DOC_MODES = ['source', 'read'] as const;

export type DocMode = (typeof DOC_MODES)[number];

export function isDocMode(value: unknown): value is DocMode {
  return (DOC_MODES as readonly unknown[]).includes(value);
}

/**
 * Read from the editing mode, and the editing mode from Read.
 *
 * The editing mode is `'source'` until Live exists. Once it does, this returns
 * whichever of the two the writer last edited in, and nothing here remembers
 * that yet.
 */
export function toggleRead(mode: DocMode): DocMode {
  return mode === 'read' ? 'source' : 'read';
}

/**
 * The editing mode if the panel is in Read, and the mode unchanged otherwise.
 *
 * What revealing a range asks for: a selection is only visible in the editor,
 * and a writer already editing should stay in whichever editing mode they chose.
 */
export function leaveRead(mode: DocMode): DocMode {
  return mode === 'read' ? 'source' : mode;
}

/**
 * Command-E, and nothing else that shares its letter.
 *
 * Control is ruled out by name because CodeMirror binds Ctrl-E to end of line
 * on the Mac, and a writer using it must not be thrown out of the editor.
 * inkling is macOS only, so Mod is Command.
 */
export function isToggleReadKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return event.key === 'e' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

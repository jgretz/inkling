/**
 * The one write to the system clipboard.
 *
 * Both flavours go in a single `ClipboardItem`: two writes would leave whichever
 * ran last alone on the pasteboard, and a mail client that asked for HTML would
 * get plain text or nothing.
 */

export type CopyResult = {ok: true} | {ok: false; reason: string};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The environment's own clipboard, or nothing where there is none.
 *
 * Read at call time rather than captured at module scope: a webview installs
 * its globals when it is ready, not when this module is imported.
 */
export function systemClipboard(): Pick<Clipboard, 'write'> | undefined {
  return globalThis.navigator?.clipboard;
}

/**
 * Writes the document as `text/html` and `text/plain` at once.
 *
 * The target is passed in rather than reached for, so the branch where there is
 * no clipboard at all is one a caller can exercise. Nothing throws out of here:
 * an absent clipboard, a runtime with no `ClipboardItem`, and a write the OS
 * refused all come back as a reason the status bar can show.
 */
export async function copyRichText(
  html: string,
  plain: string,
  target: Pick<Clipboard, 'write'> | undefined,
): Promise<CopyResult> {
  if (target === undefined) {
    return {ok: false, reason: 'there is no clipboard to write to here'};
  }
  if (typeof ClipboardItem === 'undefined') {
    return {ok: false, reason: 'this runtime cannot put formatted text on the clipboard'};
  }

  try {
    const item = new ClipboardItem({
      'text/html': new Blob([html], {type: 'text/html'}),
      'text/plain': new Blob([plain], {type: 'text/plain'}),
    });
    await target.write([item]);
    return {ok: true};
  } catch (error) {
    return {ok: false, reason: `the clipboard refused the write: ${messageOf(error)}`};
  }
}

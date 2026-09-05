import type {VaultPath} from '@inkling/vault';
import type {TurnPin} from './turn.ts';

/**
 * Settings that survive a restart. Kept small and flat: anything derivable from
 * the vault itself belongs on disk beside the documents, not here.
 */
export type Settings = {
  vault: VaultPath | undefined;
  /** Vault-relative path of the document open when the app last closed. */
  lastDoc: string | undefined;
  layout: LayoutSettings;
};

export type LayoutSettings = {
  libraryOpen: boolean;
  previewOpen: boolean;
  chatOpen: boolean;
  /** Whether voice findings are underlined in the editor. */
  marksOn: boolean;
  /**
   * A turn mode the writer pinned by hand, overriding the focus rule, or
   * `undefined` for the derived mode. Not a `ToggleKey`: it has three states.
   */
  turnPin: TurnPin;
  /** Panel widths in pixels; the editor takes whatever is left. */
  libraryWidth: number;
  previewWidth: number;
  chatWidth: number;
};

/** Everything the title bar can flip. */
export type ToggleKey = 'libraryOpen' | 'previewOpen' | 'chatOpen' | 'marksOn';

export const DEFAULT_LAYOUT: LayoutSettings = {
  libraryOpen: true,
  previewOpen: true,
  chatOpen: true,
  marksOn: true,
  turnPin: undefined,
  libraryWidth: 240,
  previewWidth: 420,
  chatWidth: 380,
};

export const DEFAULT_SETTINGS: Settings = {
  vault: undefined,
  lastDoc: undefined,
  layout: DEFAULT_LAYOUT,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asWidth(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The pin, which is one of two literals or nothing at all.
 *
 * Anything else, including a settings file written before the field existed,
 * reads as unpinned: the derived mode is the one that asks first, so falling
 * back to it cannot surprise the writer.
 */
function asPin(value: unknown): TurnPin {
  return value === 'writer' || value === 'agent' ? value : undefined;
}

/**
 * Reads whatever the settings file held into a fully populated `Settings`.
 *
 * Every field falls back independently. A settings file written by an older
 * build, or hand-edited into nonsense, degrades field by field instead of
 * dropping the writer back to an empty app.
 */
export function parseSettings(raw: unknown): Settings {
  const record = asRecord(raw);
  const layout = asRecord(record['layout']);
  return {
    vault: asString(record['vault']) as VaultPath | undefined,
    lastDoc: asString(record['lastDoc']),
    layout: {
      libraryOpen: asBoolean(layout['libraryOpen'], DEFAULT_LAYOUT.libraryOpen),
      previewOpen: asBoolean(layout['previewOpen'], DEFAULT_LAYOUT.previewOpen),
      chatOpen: asBoolean(layout['chatOpen'], DEFAULT_LAYOUT.chatOpen),
      marksOn: asBoolean(layout['marksOn'], DEFAULT_LAYOUT.marksOn),
      turnPin: asPin(layout['turnPin']),
      libraryWidth: asWidth(layout['libraryWidth'], DEFAULT_LAYOUT.libraryWidth),
      previewWidth: asWidth(layout['previewWidth'], DEFAULT_LAYOUT.previewWidth),
      chatWidth: asWidth(layout['chatWidth'], DEFAULT_LAYOUT.chatWidth),
    },
  };
}

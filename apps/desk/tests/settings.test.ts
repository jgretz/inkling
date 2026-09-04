import {describe, expect, it} from 'bun:test';
import type {VaultPath} from '@inkling/vault';
import {DEFAULT_LAYOUT, parseSettings} from '../src/lib/settings.ts';

describe('parseSettings', function () {
  it('should fall back to defaults when the file has never been written', function () {
    expect(parseSettings(null)).toEqual({
      vault: undefined,
      lastDoc: undefined,
      layout: DEFAULT_LAYOUT,
    });
  });

  it('should ignore a value that is not an object', function () {
    expect(parseSettings('corrupt').layout).toEqual(DEFAULT_LAYOUT);
  });

  it('should keep the fields it recognizes', function () {
    const result = parseSettings({
      vault: '/Users/josh/vault',
      lastDoc: 'drafts/a.md',
      layout: {...DEFAULT_LAYOUT, chatOpen: false, chatWidth: 500},
    });

    expect(result.vault).toBe('/Users/josh/vault' as VaultPath);
    expect(result.lastDoc).toBe('drafts/a.md');
    expect(result.layout.chatOpen).toBe(false);
    expect(result.layout.chatWidth).toBe(500);
  });

  it('should degrade field by field rather than dropping a whole layout', function () {
    const result = parseSettings({layout: {chatOpen: 'yes', chatWidth: -20, previewOpen: false}});

    expect(result.layout.chatOpen).toBe(DEFAULT_LAYOUT.chatOpen);
    expect(result.layout.chatWidth).toBe(DEFAULT_LAYOUT.chatWidth);
    expect(result.layout.previewOpen).toBe(false);
  });

  it('should turn voice marks on for a settings file written before they existed', function () {
    expect(parseSettings({layout: {chatOpen: false}}).layout.marksOn).toBe(true);
  });

  it('should keep voice marks off when they were turned off', function () {
    expect(parseSettings({layout: {marksOn: false}}).layout.marksOn).toBe(false);
  });

  it('should treat an empty vault string as no vault', function () {
    expect(parseSettings({vault: ''}).vault).toBeUndefined();
  });
});

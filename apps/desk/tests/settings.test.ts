import {describe, expect, it} from 'bun:test';
import type {VaultPath} from '@inkling/vault';
import {DEFAULT_LAYOUT, parseSettings} from '../src/lib/settings.ts';

describe('parseSettings', function () {
  it('should fall back to defaults when the file has never been written', function () {
    expect(parseSettings(null)).toEqual({
      vault: undefined,
      lastDoc: undefined,
      lastExportDir: undefined,
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

  it('should keep the directory the last export landed in', function () {
    expect(parseSettings({lastExportDir: '/Users/josh/Desktop'}).lastExportDir).toBe(
      '/Users/josh/Desktop',
    );
  });

  // A settings file written before exporting existed, and one holding nonsense,
  // both mean the save dialog opens wherever the OS would put it.
  it('should have no export directory when the field is absent or not a string', function () {
    expect(parseSettings({lastDoc: 'drafts/a.md'}).lastExportDir).toBeUndefined();
    expect(parseSettings({lastExportDir: 42}).lastExportDir).toBeUndefined();
    expect(parseSettings({lastExportDir: ''}).lastExportDir).toBeUndefined();
  });

  it('should treat an empty vault string as no vault', function () {
    expect(parseSettings({vault: ''}).vault).toBeUndefined();
  });

  it('should leave the turn unpinned for a settings file written before the pin existed', function () {
    expect(parseSettings({layout: {chatOpen: false}}).layout.turnPin).toBeUndefined();
  });

  it('should keep a pin that names one of the two modes', function () {
    expect(parseSettings({layout: {turnPin: 'agent'}}).layout.turnPin).toBe('agent');
    expect(parseSettings({layout: {turnPin: 'writer'}}).layout.turnPin).toBe('writer');
  });

  // Falling back to unpinned rather than to a mode: the derived mode is the one
  // that asks first, so nonsense in the file cannot hand the agent the document.
  it('should leave the turn unpinned when the field holds nonsense', function () {
    expect(parseSettings({layout: {turnPin: 'nobody'}}).layout.turnPin).toBeUndefined();
    expect(parseSettings({layout: {turnPin: true}}).layout.turnPin).toBeUndefined();
  });
});

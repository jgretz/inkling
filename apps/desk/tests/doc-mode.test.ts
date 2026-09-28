import {describe, expect, it} from 'bun:test';
import {DOC_MODES, isDocMode, isToggleReadKey, leaveRead, toggleRead} from '../src/lib/doc-mode.ts';

const NO_MODIFIERS = {metaKey: false, ctrlKey: false, altKey: false, shiftKey: false};

describe('toggleRead', function () {
  it('should go to read from source', function () {
    expect(toggleRead('source')).toBe('read');
  });

  it('should go back to source from read', function () {
    expect(toggleRead('read')).toBe('source');
  });
});

describe('leaveRead', function () {
  it('should return to source from read', function () {
    expect(leaveRead('read')).toBe('source');
  });

  it('should leave an editing mode where it is', function () {
    expect(leaveRead('source')).toBe('source');
  });
});

describe('isDocMode', function () {
  it('should know every mode it lists', function () {
    for (const mode of DOC_MODES) expect(isDocMode(mode)).toBe(true);
  });

  it('should refuse anything else', function () {
    expect(isDocMode('nonsense')).toBe(false);
    expect(isDocMode(42)).toBe(false);
  });
});

describe('isToggleReadKey', function () {
  it('should take Command-E', function () {
    expect(isToggleReadKey({...NO_MODIFIERS, key: 'e', metaKey: true})).toBe(true);
  });

  // CodeMirror's end of line on the Mac.
  it('should leave Control-E alone', function () {
    expect(isToggleReadKey({...NO_MODIFIERS, key: 'e', ctrlKey: true})).toBe(false);
  });

  it('should leave Command-E with another modifier alone', function () {
    expect(isToggleReadKey({...NO_MODIFIERS, key: 'e', metaKey: true, shiftKey: true})).toBe(false);
    expect(isToggleReadKey({...NO_MODIFIERS, key: 'e', metaKey: true, altKey: true})).toBe(false);
    expect(isToggleReadKey({...NO_MODIFIERS, key: 'e', metaKey: true, ctrlKey: true})).toBe(false);
  });

  it('should leave a plain e to the document', function () {
    expect(isToggleReadKey({...NO_MODIFIERS, key: 'e'})).toBe(false);
  });
});

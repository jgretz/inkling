import {describe, expect, it} from 'bun:test';
import {
  DOC_MODES,
  EDIT_MODES,
  isDocMode,
  isEditMode,
  isToggleEditKey,
  isToggleReadKey,
  leaveRead,
  showMode,
  toggleEditMode,
  toggleRead,
  type ModeState,
} from '../src/lib/doc-mode.ts';

const NO_MODIFIERS = {metaKey: false, ctrlKey: false, altKey: false, shiftKey: false};

/** Every state the invariant allows: each editing mode, and Read over each. */
const STATES: ModeState[] = EDIT_MODES.flatMap(function (editMode) {
  return [
    {docMode: editMode, editMode},
    {docMode: 'read', editMode},
  ];
});

function holdsInvariant(state: ModeState): boolean {
  return state.docMode === 'read' || state.docMode === state.editMode;
}

describe('mode transitions', function () {
  it('should keep the invariant from every state', function () {
    for (const state of STATES) {
      expect(holdsInvariant(toggleRead(state))).toBe(true);
      expect(holdsInvariant(leaveRead(state))).toBe(true);
      expect(holdsInvariant(toggleEditMode(state))).toBe(true);
      for (const mode of DOC_MODES) expect(holdsInvariant(showMode(state, mode))).toBe(true);
    }
  });
});

describe('showMode', function () {
  it('should remember the editing mode when showing read', function () {
    expect(showMode({docMode: 'source', editMode: 'source'}, 'read')).toEqual({
      docMode: 'read',
      editMode: 'source',
    });
  });

  it('should set both fields when showing an editing mode', function () {
    expect(showMode({docMode: 'read', editMode: 'source'}, 'live')).toEqual({
      docMode: 'live',
      editMode: 'live',
    });
  });
});

describe('toggleRead', function () {
  it('should go to read from an editing mode', function () {
    expect(toggleRead({docMode: 'live', editMode: 'live'}).docMode).toBe('read');
    expect(toggleRead({docMode: 'source', editMode: 'source'}).docMode).toBe('read');
  });

  it('should return to source from read when source was the last editing mode', function () {
    expect(toggleRead({docMode: 'read', editMode: 'source'})).toEqual({
      docMode: 'source',
      editMode: 'source',
    });
  });

  it('should return to live from read when live was the last editing mode', function () {
    expect(toggleRead({docMode: 'read', editMode: 'live'})).toEqual({
      docMode: 'live',
      editMode: 'live',
    });
  });
});

describe('leaveRead', function () {
  it('should return to the last editing mode from read', function () {
    expect(leaveRead({docMode: 'read', editMode: 'source'}).docMode).toBe('source');
    expect(leaveRead({docMode: 'read', editMode: 'live'}).docMode).toBe('live');
  });

  it('should leave an editing mode where it is', function () {
    const source: ModeState = {docMode: 'source', editMode: 'source'};
    expect(leaveRead(source)).toBe(source);
  });
});

describe('toggleEditMode', function () {
  it('should flip live and source', function () {
    expect(toggleEditMode({docMode: 'live', editMode: 'live'}).docMode).toBe('source');
    expect(toggleEditMode({docMode: 'source', editMode: 'source'}).docMode).toBe('live');
  });

  it('should go to the other editing mode from read', function () {
    expect(toggleEditMode({docMode: 'read', editMode: 'live'})).toEqual({
      docMode: 'source',
      editMode: 'source',
    });
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

describe('isEditMode', function () {
  it('should know live and source and refuse read', function () {
    expect(isEditMode('live')).toBe(true);
    expect(isEditMode('source')).toBe(true);
    expect(isEditMode('read')).toBe(false);
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

describe('isToggleEditKey', function () {
  it('should take Command-Shift-E whether the key reports e or E', function () {
    expect(isToggleEditKey({...NO_MODIFIERS, key: 'e', metaKey: true, shiftKey: true})).toBe(true);
    expect(isToggleEditKey({...NO_MODIFIERS, key: 'E', metaKey: true, shiftKey: true})).toBe(true);
  });

  it('should leave Command-E without Shift to Read', function () {
    expect(isToggleEditKey({...NO_MODIFIERS, key: 'e', metaKey: true})).toBe(false);
  });

  it('should leave Control or Option combinations alone', function () {
    expect(isToggleEditKey({...NO_MODIFIERS, key: 'E', ctrlKey: true, shiftKey: true})).toBe(false);
    expect(
      isToggleEditKey({...NO_MODIFIERS, key: 'E', metaKey: true, shiftKey: true, ctrlKey: true}),
    ).toBe(false);
    expect(
      isToggleEditKey({...NO_MODIFIERS, key: 'E', metaKey: true, shiftKey: true, altKey: true}),
    ).toBe(false);
  });
});

import {describe, expect, it} from 'bun:test';

/**
 * What the main window is allowed to do.
 *
 * These assertions exist because a missing capability fails **silently**. The
 * markup is right, the handler runs, the IPC call is refused, and nothing
 * appears anywhere: no error, no console line, no visual difference. The window
 * simply does not move when you drag it, which reads as a bug in the title bar
 * rather than as a permission that was never granted.
 *
 * Pin only what something in the app actually calls. A list that grows past what
 * is used stops being a test and becomes a copy of the file.
 */

type Capability = {
  permissions: (string | {identifier: string})[];
};

const capability: Capability = await Bun.file(
  new URL('../src-tauri/capabilities/default.json', import.meta.url),
).json();

function identifiers(): string[] {
  return capability.permissions.map(function (entry) {
    return typeof entry === 'string' ? entry : entry.identifier;
  });
}

describe('the main window capability', function () {
  it('should allow dragging the window by its title bar', function () {
    // `data-tauri-drag-region` in TitleBar.tsx is inert without this, and
    // `core:default` does not include it.
    expect(identifiers()).toContain('core:window:allow-start-dragging');
  });

  it('should allow double-clicking the title bar to zoom', function () {
    // The other half of an overlay title bar behaving like a title bar.
    expect(identifiers()).toContain('core:window:allow-toggle-maximize');
  });

  it('should scope filesystem reads to the daemon token and nothing else', function () {
    const scoped = capability.permissions.filter(function (entry) {
      return typeof entry !== 'string';
    }) as {identifier: string; allow?: {path: string}[]}[];

    const paths = scoped.flatMap(function (entry) {
      return (entry.allow ?? []).map(function (rule) {
        return rule.path;
      });
    });

    // The vault is reached through Rust commands, never through the fs plugin,
    // so the only path the webview may read is the token.
    expect([...new Set(paths)]).toEqual(['$HOME/.toryo/daemon-token']);
  });

  it('should grant no shell permission at all', function () {
    // Dispatch is reached over loopback HTTP. A shell entry here would mean
    // something regressed to spawning the toryo binaries.
    const shell = identifiers().filter(function (id) {
      return id.startsWith('shell:');
    });

    expect(shell).toEqual([]);
  });
});

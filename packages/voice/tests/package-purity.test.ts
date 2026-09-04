import {describe, expect, it} from 'bun:test';

/**
 * The package's whole claim is that it runs anywhere: in a worker, in a test,
 * in a script with no window and no network. A dependency is how that claim
 * gets lost, so the manifest is the thing under test.
 */
const manifest = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

const FORBIDDEN = [
  /^react(-dom)?$/,
  /^@tauri-apps\//,
  /^(axios|node-fetch|got|ky|undici|superagent|request)$/,
];

function declared(): string[] {
  return FIELDS.flatMap(function (field) {
    return Object.keys(manifest[field] ?? {});
  });
}

describe('@inkling/voice package manifest', function () {
  it('should declare no dependencies at all', function () {
    expect(declared()).toEqual([]);
  });

  it('should name no react, tauri or http package in any dependency field', function () {
    const offenders = declared().filter(function (name) {
      return FORBIDDEN.some(function (pattern) {
        return pattern.test(name);
      });
    });

    expect(offenders).toEqual([]);
  });
});

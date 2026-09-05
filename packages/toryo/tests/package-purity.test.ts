import {describe, expect, it} from 'bun:test';
import {Glob} from 'bun';

/**
 * The package's whole claim is that it survives the webview bundle. It uses
 * `fetch`, `URL` and `TextDecoder`, which `@inkling/voice` may not, so the
 * purity this asserts is narrower than that package's: no dependency, no import
 * of anything outside its own directory, and above all no `node:` specifier.
 *
 * The manifest cannot speak for the last one on its own. `import {readFileSync}
 * from 'node:fs'` needs no dependency entry and resolves fine under bun, and
 * neither bundler fails on it: `bun build --target=browser` stubs a builtin
 * silently and Vite hands the webview a stub that throws on first use. So the
 * breakage would arrive at runtime in the app, and the source scan below is what
 * stands in the way of it.
 */
const manifest = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

function declared(): string[] {
  return FIELDS.flatMap(function (field) {
    return Object.keys(manifest[field] ?? {});
  });
}

const SOURCE_ROOT = Bun.fileURLToPath(new URL('../src/', import.meta.url));

async function sources(): Promise<Array<{path: string; text: string}>> {
  const found: Array<{path: string; text: string}> = [];
  for await (const path of new Glob('**/*.ts').scan({cwd: SOURCE_ROOT})) {
    found.push({path, text: await Bun.file(`${SOURCE_ROOT}${path}`).text()});
  }
  return found;
}

const SOURCES = await sources();

/** Comments name the toryo modules this package copied from; code is what is scanned. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:\\])\/\/[^\n]*/g;

function code(text: string): string {
  return text.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '$1');
}

const STATIC_IMPORT = /\b(?:import|export)\b[^'"]*?\bfrom\s*'([^'\n]+)'/g;
const DYNAMIC_IMPORT = /\bimport\s*\(?\s*'([^'\n]+)'/g;

function specifiers(text: string): string[] {
  const scanned = code(text);
  return [...scanned.matchAll(STATIC_IMPORT), ...scanned.matchAll(DYNAMIC_IMPORT)].map(
    function (match) {
      return match[1] ?? '';
    },
  );
}

describe('@inkling/toryo package manifest', function () {
  it('should declare no dependencies at all', function () {
    expect(declared()).toEqual([]);
  });
});

describe('@inkling/toryo source', function () {
  it('should have source files to scan, so the scans below can fail', function () {
    expect(SOURCES.length).toBeGreaterThan(3);
  });

  it('should import nothing but its own files', function () {
    const foreign = SOURCES.flatMap(function (file) {
      return specifiers(file.text)
        .filter(function (specifier) {
          return !specifier.startsWith('./') && !specifier.startsWith('../');
        })
        .map(function (specifier) {
          return `${file.path}: ${specifier}`;
        });
    });

    expect(foreign).toEqual([]);
  });

  // Named separately from the scan above even though it can only fail with it:
  // a `node:` import is the one failure that reaches the writer as a blank
  // window rather than as a build error, so it is worth its own red line.
  it('should name no node builtin anywhere in its source', function () {
    const builtins = SOURCES.filter(function (file) {
      return code(file.text).includes('node:');
    }).map(function (file) {
      return file.path;
    });

    expect(builtins).toEqual([]);
  });
});

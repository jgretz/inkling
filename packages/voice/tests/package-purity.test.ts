import {describe, expect, it} from 'bun:test';
import {Glob} from 'bun';

/**
 * The package's whole claim is that it runs anywhere: in a worker, in a test,
 * in a script with no window and no network. Two things can lose that claim, so
 * both are under test here.
 *
 * The manifest is the first. The source is the second, and the manifest cannot
 * speak for it: `import {readFileSync} from 'node:fs'` needs no dependency
 * entry, resolves fine, and would leave a manifest test green while the package
 * stopped being pure.
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

/** Comments carry prose about documents and processes; code is what is scanned. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:\\])\/\/[^\n]*/g;

function code(text: string): string {
  return text.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '$1');
}

/**
 * Every module specifier a file names, static, type-only and dynamic alike.
 *
 * Both patterns run from a statement keyword rather than from a bare `from`,
 * because `words.ts` has the word `from` inside a string literal and a looser
 * pattern reads the next quoted run as an import.
 */
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

/** Host capabilities a pure function cannot reach for. */
const HOST_GLOBALS: ReadonlyArray<{name: string; pattern: RegExp}> = [
  {name: 'window', pattern: /\bwindow\s*[.[]/},
  {name: 'document', pattern: /\bdocument\s*[.[]/},
  {name: 'localStorage', pattern: /\blocalStorage\b/},
  {name: 'fetch', pattern: /\bfetch\s*\(/},
  {name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/},
  {name: 'process', pattern: /\bprocess\s*[.[]/},
  {name: 'Bun', pattern: /\bBun\s*[.[]/},
  {name: 'require', pattern: /\brequire\s*\(/},
];

describe('@inkling/voice package manifest', function () {
  it('should declare no dependencies at all', function () {
    expect(declared()).toEqual([]);
  });
});

describe('@inkling/voice source', function () {
  it('should have source files to scan, so the scans below can fail', function () {
    expect(SOURCES.length).toBeGreaterThan(15);
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

  it('should reach for no window, filesystem, network or runtime global', function () {
    const reached = SOURCES.flatMap(function (file) {
      return HOST_GLOBALS.filter(function (capability) {
        return capability.pattern.test(code(file.text));
      }).map(function (capability) {
        return `${file.path}: ${capability.name}`;
      });
    });

    expect(reached).toEqual([]);
  });
});

/**
 * Counts what `@inkling/voice` fires on across real prose.
 *
 * The thresholds in `packages/voice/src/constants.ts` are only defensible
 * against a corpus, and this is the corpus: the example vault a developer points
 * the app at, and inkling's own documentation. Roadmap 1.2 and 1.3 rerun it
 * while tuning, which is why it is committed rather than thrown away.
 *
 * Run: `bun scripts/voice-report.ts`
 *
 * The import is relative because nothing at the repository root declares
 * `@inkling/voice`, and wiring the package into a workspace manifest is 1.2's
 * job, not this script's.
 */

import {Glob} from 'bun';
import {check, DETECTORS, extract} from '../packages/voice/src/index.ts';

// `pathname` would leave a checkout under a path with a space percent-encoded,
// and the glob below would then scan nothing at all.
const root = Bun.fileURLToPath(new URL('..', import.meta.url));

const ALL_DETECTORS = DETECTORS.map(function (detector) {
  return detector.id;
});

type Corpus = {
  name: string;
  pattern: string;
};

const CORPORA: Corpus[] = [
  {name: 'examples/vault/', pattern: 'examples/vault/**/*.md'},
  {name: 'docs/*.md', pattern: 'docs/*.md'},
];

type Tally = {
  files: number;
  words: number;
  counts: Map<string, number>;
};

async function tally(corpus: Corpus): Promise<Tally> {
  const result: Tally = {files: 0, words: 0, counts: new Map()};

  for await (const path of new Glob(corpus.pattern).scan({cwd: root})) {
    const source = await Bun.file(`${root}${path}`).text();
    result.files += 1;
    // Prose words, which is the number the density thresholds are stated in.
    result.words += extract(source).sentences.reduce(function (total, sentence) {
      return total + sentence.words;
    }, 0);

    for (const finding of check(source, {detectors: ALL_DETECTORS})) {
      result.counts.set(finding.ruleId, (result.counts.get(finding.ruleId) ?? 0) + 1);
    }
  }

  return result;
}

const started = performance.now();
const tallies = await Promise.all(CORPORA.map(tally));
const elapsed = performance.now() - started;

const labelWidth = Math.max(
  ...ALL_DETECTORS.map(function (id) {
    return id.length;
  }),
  'rule'.length,
);

const cellWidth = Math.max(
  ...CORPORA.map(function (corpus) {
    return corpus.name.length;
  }),
);

/** One label plus one right-aligned cell per corpus, which every line here is. */
function row(label: string, cells: readonly string[]): string {
  const padded = cells.map(function (cell) {
    return cell.padStart(cellWidth);
  });
  return `${label.padEnd(labelWidth)}  ${padded.join('  ')}\n`;
}

/** The horizontal divider under the header and above the totals. */
function divider(): string {
  return row(
    '-'.repeat(labelWidth),
    CORPORA.map(function () {
      return '-'.repeat(cellWidth);
    }),
  );
}

function counts(id: string): string[] {
  return tallies.map(function (result) {
    return String(result.counts.get(id) ?? 0);
  });
}

const lines = [
  row(
    'rule',
    CORPORA.map(function (corpus) {
      return corpus.name;
    }),
  ),
  divider(),
  ...ALL_DETECTORS.map(function (id) {
    return row(id, counts(id));
  }),
  divider(),
  row(
    'files',
    tallies.map(function (result) {
      return String(result.files);
    }),
  ),
  row(
    'words',
    tallies.map(function (result) {
      return String(result.words);
    }),
  ),
  `\nchecked in ${elapsed.toFixed(1)}ms\n`,
];

process.stdout.write(lines.join(''));

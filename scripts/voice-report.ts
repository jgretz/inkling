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
import {check, extract} from '../packages/voice/src/index.ts';
import {DETECTORS} from '../packages/voice/src/registry.ts';

const root = new URL('..', import.meta.url).pathname;

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

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.padStart(width);
}

const started = performance.now();
const tallies = await Promise.all(CORPORA.map(tally));
const elapsed = performance.now() - started;

const idWidth = Math.max(...ALL_DETECTORS.map((id) => id.length), 'rule'.length);
const columnWidth = Math.max(...CORPORA.map((corpus) => corpus.name.length));

const header = [pad('rule', idWidth), ...CORPORA.map((c) => padStart(c.name, columnWidth))];
process.stdout.write(`${header.join('  ')}\n`);
process.stdout.write(
  `${'-'.repeat(idWidth)}  ${CORPORA.map(() => '-'.repeat(columnWidth)).join('  ')}\n`,
);

for (const id of ALL_DETECTORS) {
  const cells = tallies.map(function (result) {
    return padStart(String(result.counts.get(id) ?? 0), columnWidth);
  });
  process.stdout.write(`${pad(id, idWidth)}  ${cells.join('  ')}\n`);
}

process.stdout.write(
  `${'-'.repeat(idWidth)}  ${CORPORA.map(() => '-'.repeat(columnWidth)).join('  ')}\n`,
);
process.stdout.write(
  `${pad('files', idWidth)}  ${tallies.map((t) => padStart(String(t.files), columnWidth)).join('  ')}\n`,
);
process.stdout.write(
  `${pad('words', idWidth)}  ${tallies.map((t) => padStart(String(t.words), columnWidth)).join('  ')}\n`,
);
process.stdout.write(`\nchecked in ${elapsed.toFixed(1)}ms\n`);

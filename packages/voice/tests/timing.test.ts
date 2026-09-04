import {describe, expect, it} from 'bun:test';
import {check} from '../src/check.ts';

const PARAGRAPH = [
  'The trouble with a tool that finishes your sentence is that it answers a',
  'question nobody asked. What a writer wants, most of the time, is an argument',
  'about the shape of the thing. The preview tracks the editor keystroke by',
  'keystroke, so there is never a moment where what you see is behind what you',
  'wrote down in the file.',
].join('\n');

/** Roughly five thousand words, built in code so no fixture can drift. */
function longDocument(): string {
  return Array.from({length: 70}, function (_, index) {
    return `## Section ${index + 1}\n\n${PARAGRAPH}\n\nAnd a second — paragraph, which is short.`;
  }).join('\n\n');
}

describe('check over a long document', function () {
  it('should return findings, and report how long it took', function () {
    const source = longDocument();

    const started = performance.now();
    const findings = check(source);
    const elapsed = performance.now() - started;

    // Printed rather than asserted on purpose. Roadmap 1.2 decides whether the
    // editor debounces, and that decision needs the number, not a gate that
    // goes red on a slow machine.
    process.stdout.write(
      `[timing] ${source.split(/\s+/).length} words checked in ${elapsed.toFixed(1)}ms, ${findings.length} findings\n`,
    );

    expect(findings.length).toBeGreaterThan(0);
  });
});

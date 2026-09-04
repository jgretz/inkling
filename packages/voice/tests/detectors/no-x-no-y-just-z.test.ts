import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['no-x-no-y-just-z']});
}

describe('no-x-no-y-just-z', function () {
  it('should flag the no X, no Y, just Z cadence', function () {
    const source = 'No server, no daemon, just files on disk.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('what it does');
  });

  it('should flag the only variant', function () {
    expect(findings('No config, no plugins, only markdown.')).toHaveLength(1);
  });

  it('should not flag two negatives joined by and', function () {
    expect(findings('No server and no daemon, just files.')).toEqual([]);
  });

  it('should not flag inside a fenced code block', function () {
    const source = ['```', 'No server, no daemon, just files.', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});

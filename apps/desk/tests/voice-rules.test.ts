import {describe, expect, it} from 'bun:test';
import {DETECTORS, type Anchor, type Finding} from '@inkling/voice';
import {dismissalOf, groupFindings, ruleLabel, snippet} from '../src/lib/voice-rules.ts';

function finding(ruleId: string, start: number): Finding {
  return {
    ruleId,
    anchor: {quote: 'x', prefix: '', suffix: '', hint: start},
    range: {start, end: start + 1},
    explain: 'do something else',
  };
}

function anchor(fields: Partial<Anchor>): Anchor {
  return {quote: 'q', prefix: '', suffix: '', hint: 0, ...fields};
}

describe('ruleLabel', function () {
  it('should label every registered detector, in registry order', function () {
    // Asserted against the registry rather than against a count: a seventeenth
    // detector, or a renamed id, has to fail here until it is labelled.
    const labels = DETECTORS.map(function (detector) {
      return ruleLabel(detector.id);
    });

    expect(labels).toEqual([
      'Em dash',
      'En dash as an aside',
      'Spaced hyphen',
      'Curly quotes',
      'False contrast',
      'Not only, but',
      'No X, no Y, just Z',
      'Title Case heading',
      'Bold term with a colon',
      'Banned word',
      'Banned opener',
      'Throat clearing',
      'Signposting',
      'Rule of three',
      'Stacked transitions',
      'Uniform sentence length',
    ]);
  });

  it('should fall back to the raw id for a rule it does not know', function () {
    expect(ruleLabel('not-a-rule')).toBe('not-a-rule');
  });
});

describe('groupFindings', function () {
  it('should return groups in first-appearance order with findings in document order', function () {
    const findings = [
      finding('spaced-hyphen', 4),
      finding('em-dash', 9),
      finding('spaced-hyphen', 21),
      finding('em-dash', 30),
    ];

    const groups = groupFindings(findings);

    expect(
      groups.map(function (group) {
        return group.ruleId;
      }),
    ).toEqual(['spaced-hyphen', 'em-dash']);
    expect(
      groups[0]?.findings.map(function (entry) {
        return entry.range.start;
      }),
    ).toEqual([4, 21]);
    expect(
      groups[1]?.findings.map(function (entry) {
        return entry.range.start;
      }),
    ).toEqual([9, 30]);
  });

  it('should carry the display label on each group', function () {
    expect(groupFindings([finding('rule-of-three', 0)])[0]?.label).toBe('Rule of three');
  });

  it('should return nothing for a document with no findings', function () {
    expect(groupFindings([])).toEqual([]);
  });
});

describe('snippet', function () {
  it('should keep the end of the prefix and the start of the suffix', function () {
    const result = snippet(
      anchor({
        prefix: 'a'.repeat(40) + 'PREFIX',
        quote: '-',
        suffix: 'SUFFIX' + 'b'.repeat(40),
      }),
    );

    expect(result.quote).toBe('-');
    expect(result.before.endsWith('PREFIX')).toBe(true);
    expect(result.before.length).toBe(24);
    expect(result.after.startsWith('SUFFIX')).toBe(true);
    expect(result.after.length).toBe(24);
  });

  it('should collapse newlines so an entry stays one line', function () {
    const result = snippet(anchor({prefix: 'one\ntwo', quote: 'a\n\nb', suffix: 'three\nfour'}));

    expect(result.before).toBe('one two');
    expect(result.quote).toBe('a b');
    expect(result.after).toBe('three four');
  });
});

describe('dismissalOf', function () {
  it('should gather the row\u2019s flat anchor columns back into an anchor', function () {
    const row = {
      id: 7,
      docPath: 'drafts/a.md',
      ruleId: 'em-dash',
      quote: '\u2014',
      prefix: 'before ',
      suffix: ' after',
      hint: 12,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(dismissalOf(row)).toEqual({
      id: 7,
      ruleId: 'em-dash',
      anchor: {quote: '\u2014', prefix: 'before ', suffix: ' after', hint: 12},
    });
  });
});

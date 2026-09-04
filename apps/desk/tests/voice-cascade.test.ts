import {describe, expect, it} from 'bun:test';
import type {DocPath} from '@inkling/vault';
import {check, resolveVoice, DEFAULT_VOICE_THRESHOLDS} from '@inkling/voice';
import {cascadeFor, ruleSetPathsFor, voiceNotice} from '../src/lib/voice-cascade.ts';

/** Prose with one em dash in it, which is the whole signal these tests read. */
const DRAFT = 'A sentence — with an em dash in it.';

function sources(entries: Record<string, string>): ReadonlyMap<DocPath, string> {
  return new Map(
    Object.entries(entries).map(function ([path, source]): [DocPath, string] {
      return [path as DocPath, source];
    }),
  );
}

/** A rule set file, written the way a writer would write one. */
function ruleSet(frontmatter: string, guidance = ''): string {
  return `---\n${frontmatter}\n---\n\n${guidance}`;
}

function resolveFor(
  docPath: string,
  draft: string,
  files: Record<string, string>,
): ReturnType<typeof resolveVoice> {
  return resolveVoice(cascadeFor(docPath as DocPath, draft, sources(files)).sets);
}

function ruleIds(docPath: string, draft: string, files: Record<string, string>): string[] {
  const voice = resolveFor(docPath, draft, files);
  return check(draft, {detectors: voice.detectors, thresholds: voice.thresholds}).map(
    function (finding) {
      return finding.ruleId;
    },
  );
}

describe('ruleSetPathsFor', function () {
  it('should read the root and each ancestor directory, root first', function () {
    expect(ruleSetPathsFor('drafts/deep/a.md' as DocPath)).toEqual([
      'voice.md',
      'drafts/voice.md',
      'drafts/deep/voice.md',
    ] as DocPath[]);
  });

  it('should ask only for the root when the document sits at the root', function () {
    expect(ruleSetPathsFor('a.md' as DocPath)).toEqual(['voice.md'] as DocPath[]);
  });
});

describe('cascadeFor', function () {
  it('should not fire a rule its group turned off', function () {
    const files = {'drafts/voice.md': ruleSet('rules:\n  em-dash: off')};

    expect(ruleIds('drafts/a.md', DRAFT, files)).not.toContain('em-dash');
  });

  it('should still fire that rule for a document outside the group', function () {
    // The same rule set, the same prose, a different directory. Without this
    // the test above would pass on a cascade that disabled the rule everywhere.
    const files = {'drafts/voice.md': ruleSet('rules:\n  em-dash: off')};

    expect(ruleIds('notes/b.md', DRAFT, files)).toContain('em-dash');
  });

  it('should let a document turn a rule back on that its group turned off', function () {
    const files = {'drafts/voice.md': ruleSet('rules:\n  em-dash: off')};
    const draft = `---\nvoice:\n  rules:\n    em-dash: on\n---\n\n${DRAFT}`;

    expect(ruleIds('drafts/a.md', draft, files)).toContain('em-dash');
  });

  it('should give the document level the threshold when every level sets one', function () {
    const files = {
      'voice.md': ruleSet('thresholds:\n  wordsPerTriplet: 100'),
      'drafts/voice.md': ruleSet('thresholds:\n  wordsPerTriplet: 200'),
    };
    const draft = '---\nvoice:\n  thresholds:\n    wordsPerTriplet: 400\n---\n\nProse.';

    expect(resolveFor('drafts/a.md', draft, files).thresholds.wordsPerTriplet).toBe(400);
  });

  it('should fall back to the group when the document sets no threshold', function () {
    const files = {
      'voice.md': ruleSet('thresholds:\n  wordsPerTriplet: 100'),
      'drafts/voice.md': ruleSet('thresholds:\n  wordsPerTriplet: 200'),
    };

    expect(resolveFor('drafts/a.md', 'Prose.', files).thresholds.wordsPerTriplet).toBe(200);
  });

  it('should fall back to the root when neither the group nor the document sets one', function () {
    const files = {'voice.md': ruleSet('thresholds:\n  wordsPerTriplet: 100')};

    expect(resolveFor('drafts/a.md', 'Prose.', files).thresholds.wordsPerTriplet).toBe(100);
  });

  it('should fall back to the tuned default when no level sets one at all', function () {
    expect(resolveFor('drafts/a.md', 'Prose.', {}).thresholds.wordsPerTriplet).toBe(
      DEFAULT_VOICE_THRESHOLDS.wordsPerTriplet,
    );
  });

  it('should read a rule set the writer is still typing, not the one on disk', function () {
    // The document level comes from the live draft. `sources` holds what the
    // last vault scan read, which is a save behind.
    const files = {'drafts/a.md': `---\nvoice:\n  rules:\n    em-dash: on\n---\n\n${DRAFT}`};
    const draft = `---\nvoice:\n  rules:\n    em-dash: off\n---\n\n${DRAFT}`;

    expect(ruleIds('drafts/a.md', draft, files)).not.toContain('em-dash');
  });

  it('should keep every level of guidance, root first', function () {
    const files = {
      'voice.md': ruleSet('rules:\n  em-dash: off', 'Short sentences.'),
      'drafts/voice.md': ruleSet('rules:\n  curly-quotes: off', 'Never open with a question.'),
    };

    expect(resolveFor('drafts/a.md', 'Prose.', files).guidance).toEqual([
      'Short sentences.',
      'Never open with a question.',
    ]);
  });

  it('should name the file a problem came from', function () {
    const files = {'drafts/voice.md': ruleSet('rules:\n  em-dashes: off')};

    const {problems} = cascadeFor('drafts/a.md' as DocPath, 'Prose.', sources(files));

    expect(problems).toEqual([
      'drafts/voice.md: rules.em-dashes: no rule by that name, so it would do nothing',
    ]);
  });

  it('should name the document itself for a problem in its own frontmatter', function () {
    const draft = '---\nvoice:\n  thresholds:\n    wordsPerTriplet: nope\n---\n\nProse.';

    const {problems} = cascadeFor('drafts/a.md' as DocPath, draft, sources({}));

    expect(problems).toEqual([
      'drafts/a.md: thresholds.wordsPerTriplet: expected a number above zero',
    ]);
  });

  it('should apply a voice.md that is itself the open document only once over', function () {
    // Its own frontmatter arrives twice, as its directory's rule set and again
    // as its own. Last-wins makes that idempotent rather than a special case.
    const draft = ruleSet('rules:\n  em-dash: off', DRAFT);

    expect(ruleIds('drafts/voice.md', draft, {'drafts/voice.md': draft})).not.toContain('em-dash');
  });

  it('should ignore frontmatter keys that are not a rule set', function () {
    const draft = '---\ntitle: A draft\ntags: [essay]\n---\n\nProse.';

    expect(cascadeFor('drafts/a.md' as DocPath, draft, sources({})).problems).toEqual([]);
  });
});

describe('voiceNotice', function () {
  it('should say nothing when every rule set parsed', function () {
    expect(voiceNotice([])).toBeUndefined();
  });

  it('should lead with the first problem and count the rest', function () {
    expect(
      voiceNotice(['voice.md: rules.x: no rule by that name', 'voice.md: b', 'voice.md: c']),
    ).toBe('Voice rules: voice.md: rules.x: no rule by that name (and 2 more)');
  });

  it('should not count a second problem when there is only one', function () {
    expect(voiceNotice(['voice.md: b'])).toBe('Voice rules: voice.md: b');
  });
});

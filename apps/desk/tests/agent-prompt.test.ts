import {describe, expect, it} from 'bun:test';
import type {DocPath, GroupPath} from '@inkling/vault';
import {DEFAULT_VOICE_THRESHOLDS, resolveVoice, type ResolvedVoice} from '@inkling/voice';
import {estimateTokens, type AgentContext} from '../src/lib/agent.ts';
import type {ContextReference} from '../src/lib/references.ts';
import {followUpPrompt, openingPrompt, WRITING_COMPANION} from '../src/lib/agent-prompt.ts';

const GUIDANCE = 'Write the way you talk. Short sentences beat clever ones.';

const DRAFT = '# The piece\n\nThe body of the draft.';

function voice(overrides: Partial<ResolvedVoice> = {}): ResolvedVoice {
  return {...resolveVoice([]), ...overrides};
}

function reference(overrides: Partial<ContextReference> = {}): ContextReference {
  const source = overrides.source ?? 'The house tone, at length.';
  return {
    id: 1,
    kind: 'doc',
    title: 'House tone',
    source,
    target: 'notes/tone.md',
    origin: {level: 'document'},
    missing: false,
    suppressedBy: undefined,
    tokens: estimateTokens(source),
    ...overrides,
  };
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    doc: {path: 'drafts/piece.md' as DocPath, title: 'The piece', source: DRAFT},
    selection: undefined,
    references: [],
    ...overrides,
  };
}

describe('openingPrompt', function () {
  it('should carry the long guidance, the document and the message', function () {
    const prompt = openingPrompt({
      voice: voice({guidance: [GUIDANCE]}),
      context: context(),
      authorized: false,
      message: 'Tighten the ending',
    });

    expect(prompt).toContain(GUIDANCE);
    expect(prompt).toContain(DRAFT);
    expect(prompt).toContain('Tighten the ending');
  });

  it('should name every rule in force', function () {
    const prompt = openingPrompt({
      voice: voice(),
      context: context(),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).toContain('em-dash');
    expect(prompt).toContain('sentence-length-uniformity');
  });

  it('should say so plainly when the writer turned every rule off', function () {
    const prompt = openingPrompt({
      voice: voice({detectors: []}),
      context: context(),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).toContain('turned every rule off');
  });

  // Only the moved ones: listing every threshold at its default would be five
  // lines of noise in every turn.
  it('should name a threshold this document moved and no other', function () {
    const prompt = openingPrompt({
      voice: voice({thresholds: {...DEFAULT_VOICE_THRESHOLDS, wordsPerTriplet: 400}}),
      context: context(),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).toContain('wordsPerTriplet 400');
    expect(prompt).not.toContain('connectiveRun');
  });

  it('should carry a reference body and name the group it was inherited from', function () {
    const prompt = openingPrompt({
      voice: voice(),
      context: context({
        references: [reference({origin: {level: 'group', group: 'drafts' as GroupPath}})],
      }),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).toContain('inherited from drafts');
    expect(prompt).toContain('The house tone, at length.');
  });

  // Retrieval is phase 5. A link that arrived as an empty body would read to the
  // agent as a page with nothing on it.
  it('should send a link as a title and an address, saying it was not fetched', function () {
    const prompt = openingPrompt({
      voice: voice(),
      context: context({
        references: [
          reference({
            kind: 'link',
            title: 'The style guide',
            target: 'https://example.com',
            source: '',
          }),
        ],
      }),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).toContain('https://example.com');
    expect(prompt).toContain('Not fetched.');
  });

  it('should say a reference names a file the vault has lost', function () {
    const prompt = openingPrompt({
      voice: voice(),
      context: context({references: [reference({missing: true, source: ''})]}),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).toContain('no longer in the vault');
  });
});

describe('followUpPrompt', function () {
  it('should leave the long guidance out of a quiet turn', function () {
    const prompt = followUpPrompt({
      voice: voice({guidance: [GUIDANCE]}),
      context: context(),
      previous: context(),
      checkerFiring: false,
      authorized: false,
      message: 'And the opening?',
    });

    expect(prompt).not.toContain(GUIDANCE);
    expect(prompt).toContain('And the opening?');
  });

  // The moment it earns its tokens: the draft is tripping the very rules the
  // guidance explains, so the agent is about to be asked about them.
  it('should bring the long guidance back when the checker is firing', function () {
    const prompt = followUpPrompt({
      voice: voice({guidance: [GUIDANCE]}),
      context: context(),
      previous: context(),
      checkerFiring: true,
      authorized: false,
      message: 'And the opening?',
    });

    expect(prompt).toContain(GUIDANCE);
  });

  it('should keep the compact rules on every turn', function () {
    const prompt = followUpPrompt({
      voice: voice(),
      context: context(),
      previous: context(),
      checkerFiring: false,
      authorized: false,
      message: 'And the opening?',
    });

    expect(prompt).toContain('em-dash');
  });

  it('should not re-send a draft that has not moved', function () {
    const prompt = followUpPrompt({
      voice: voice(),
      context: context(),
      previous: context(),
      checkerFiring: false,
      authorized: false,
      message: 'And the opening?',
    });

    expect(prompt).not.toContain(DRAFT);
  });

  it('should re-send the draft once the writer has edited it', function () {
    const edited = context({
      doc: {path: 'drafts/piece.md' as DocPath, title: 'The piece', source: `${DRAFT}\n\nMore.`},
    });

    const prompt = followUpPrompt({
      voice: voice(),
      context: edited,
      previous: context(),
      checkerFiring: false,
      authorized: false,
      message: 'Better?',
    });

    expect(prompt).toContain('More.');
  });

  it('should send a selection the writer has just made', function () {
    const prompt = followUpPrompt({
      voice: voice(),
      context: context({selection: 'the last paragraph'}),
      previous: context(),
      checkerFiring: false,
      authorized: false,
      message: 'This bit',
    });

    expect(prompt).toContain('the last paragraph');
  });

  it('should send only a reference that was added since the last turn', function () {
    const before = context({references: [reference()]});
    const now = context({
      references: [
        reference(),
        reference({id: 2, title: 'The brief', source: 'What the client asked for.'}),
      ],
    });

    const prompt = followUpPrompt({
      voice: voice(),
      context: now,
      previous: before,
      checkerFiring: false,
      authorized: false,
      message: 'Does it answer the brief?',
    });

    expect(prompt).toContain('What the client asked for.');
    expect(prompt).not.toContain('The house tone, at length.');
  });

  it('should say when a reference was taken away', function () {
    const prompt = followUpPrompt({
      voice: voice(),
      context: context({references: []}),
      previous: context({references: [reference()]}),
      checkerFiring: false,
      authorized: false,
      message: 'Never mind that one',
    });

    expect(prompt).toContain('Reference removed: House tone');
  });
});

describe('the persona', function () {
  // It reaches the model as `agent.roleInstructionOverride`, which governs every
  // turn of the session, so repeating it as the first message would be the same
  // words twice.
  it('should not be repeated inside the opening prompt', function () {
    const prompt = openingPrompt({
      voice: voice(),
      context: context(),
      authorized: false,
      message: 'Hello',
    });

    expect(prompt).not.toContain(WRITING_COMPANION);
  });

  // It is sent once and governs every turn, so it describes the regime in
  // general terms. Which kind is legal right now is the turn block's job, and
  // the turn block is re-sent every turn precisely because it changes.
  it('should describe the two-turn regime rather than a flat refusal to edit', function () {
    expect(WRITING_COMPANION).toContain('written by turns');
    expect(WRITING_COMPANION).toContain('propose');
    expect(WRITING_COMPANION).not.toContain('cannot edit');
  });

  it('should say the agent never writes the file itself, on either turn', function () {
    expect(WRITING_COMPANION).toContain('the file yourself, on either turn');
  });
});

describe('the turn block', function () {
  function opening(authorized: boolean): string {
    return openingPrompt({voice: voice(), context: context(), authorized, message: 'Rewrite this'});
  }

  function followUp(authorized: boolean): string {
    return followUpPrompt({
      voice: voice(),
      context: context(),
      previous: context(),
      checkerFiring: false,
      authorized,
      message: 'Rewrite this',
    });
  }

  it('should tell an unauthorized turn to propose rather than change the document', function () {
    const prompt = opening(false);

    expect(prompt).toContain('Do not change the document');
    expect(prompt).toContain('"kind": "proposed"');
  });

  it('should tell an authorized turn it may change the document', function () {
    const prompt = opening(true);

    expect(prompt).toContain('You may change the document');
    expect(prompt).toContain('"kind": "made"');
    expect(prompt).not.toContain('Do not change the document');
  });

  // Re-sent every turn for the same reason the compact rules are, and a
  // stronger one: which kind is legal changes between one turn and the next, so
  // a stale copy is a wrong copy.
  it('should carry the turn into a follow-up as well as an opening', function () {
    expect(followUp(false)).toContain('Do not change the document');
    expect(followUp(true)).toContain('You may change the document');
  });

  // Long, and unchanged between turns, so it goes with the once-only material.
  it('should send the block format once, at the top of the session', function () {
    expect(opening(false)).toContain('```inkling');
    expect(followUp(false)).not.toContain('```inkling');
  });
});

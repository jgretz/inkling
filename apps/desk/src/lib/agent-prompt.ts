import {DEFAULT_VOICE_THRESHOLDS, type ResolvedVoice, type VoiceThresholds} from '@inkling/voice';
import type {AgentContext} from './agent.ts';
import type {ContextReference} from './references.ts';

/**
 * Turning a turn into the text a session is actually sent.
 *
 * Pure, the way `voice-cascade.ts` is pure: no window, no clock, no database.
 * The cascade is resolved elsewhere and arrives as `{detectors, thresholds,
 * guidance}`; nothing here derives a rule of its own.
 *
 * ## Why the first turn is different from every other one
 *
 * A held session's first turn is the payload's own `prompt`: the daemon spawns
 * the worker and that text runs immediately. Everything after it is a bare
 * message pushed onto the same live process, which still has the whole
 * conversation in front of it. So the document, the references and the long
 * voice guidance are sent once, at the top, and a later turn sends only what
 * moved since the one before it.
 *
 * The compact rules are the exception: they go in every turn. They are two
 * lines, and they are the instruction most likely to be forgotten by the twelfth
 * message of a long conversation.
 */

/** The threshold keys, so a moved one can be named without hard-coding a list. */
const THRESHOLD_KEYS = Object.keys(DEFAULT_VOICE_THRESHOLDS) as Array<keyof VoiceThresholds>;

/**
 * Who the agent is, sent once per session as `agent.roleInstructionOverride`.
 *
 * It lives here rather than in the transport because it is prose about writing,
 * and this is the file that owns the prose the agent reads. The override is the
 * highest-precedence role instruction toryo takes, which is what stops a writing
 * companion from arriving as toryo's engineering explorer.
 *
 * It is NOT repeated in {@link openingPrompt}. The override reaches the model as
 * its system prompt and governs every turn of the session, so sending it again
 * as the first message would be the same words twice.
 */
export const WRITING_COMPANION = `You are a writing companion inside inkling, a markdown editor.

The person you are talking to is writing an article, an email or a proposal.
They are the author. You are not drafting for them unless they ask you to.

What you are good for: a second opinion on an argument, an outline that is
missing a step, a paragraph that will not sit right, a sentence that says less
than it means to. Read what they sent, answer the question they actually asked,
and say the useful thing first.

How to answer:

- Plain prose. No preamble, no summary of what you are about to say, no closing
  offer of further help.
- Quote the writer's own words when you are pointing at something, so they can
  find it.
- When you disagree, say so and say why. Agreement they did not earn is worth
  nothing to them.
- You cannot edit their document. Suggest the replacement text and let them take
  it.`;

/** Everything the first turn of a session needs. */
export type OpeningTurn = {
  voice: ResolvedVoice;
  context: AgentContext;
  message: string;
};

/** Everything a later turn needs, including what the last one already carried. */
export type FollowUpTurn = {
  voice: ResolvedVoice;
  context: AgentContext;
  /** What the previous turn was sent with, so only the difference is re-sent. */
  previous: AgentContext;
  /** True when the voice checker is raising findings on the current draft. */
  checkerFiring: boolean;
  message: string;
};

/**
 * The first turn: everything the agent needs to know, once.
 *
 * The order is deliberate. Rules and guidance come before the prose so they read
 * as instructions about what follows rather than as an afterthought, and the
 * writer's message comes last so it is the freshest thing in the context.
 */
export function openingPrompt({voice, context, message}: OpeningTurn): string {
  return blocks([
    rulesBlock(voice),
    ...voice.guidance.map(guidanceBlock),
    documentBlock(context),
    selectionBlock(context.selection),
    ...context.references.map(referenceBlock),
    messageBlock(message),
  ]);
}

/**
 * A later turn: what the writer said, plus only what has changed under them.
 *
 * The long guidance returns when `checkerFiring` is true. That is the moment it
 * earns its tokens: the draft is tripping the very rules the guidance explains,
 * so the agent is about to be asked about them.
 */
export function followUpPrompt({
  voice,
  context,
  previous,
  checkerFiring,
  message,
}: FollowUpTurn): string {
  const draftMoved = context.doc?.source !== previous.doc?.source;
  const selectionMoved = context.selection !== previous.selection;

  return blocks([
    rulesBlock(voice),
    ...(checkerFiring ? voice.guidance.map(guidanceBlock) : []),
    ...(draftMoved ? [documentBlock(context)] : []),
    ...(selectionMoved ? [selectionBlock(context.selection)] : []),
    ...added(context.references, previous.references).map(referenceBlock),
    ...removed(context.references, previous.references).map(detachedBlock),
    messageBlock(message),
  ]);
}

/** The references in `now` that were not in `before`, in assembled order. */
function added(
  now: readonly ContextReference[],
  before: readonly ContextReference[],
): ContextReference[] {
  const seen = new Set(
    before.map(function (entry) {
      return entry.id;
    }),
  );
  return now.filter(function (entry) {
    return !seen.has(entry.id);
  });
}

function removed(
  now: readonly ContextReference[],
  before: readonly ContextReference[],
): ContextReference[] {
  const kept = new Set(
    now.map(function (entry) {
      return entry.id;
    }),
  );
  return before.filter(function (entry) {
    return !kept.has(entry.id);
  });
}

/**
 * The rules in force, as one short paragraph.
 *
 * Detector ids rather than their explanations: the ids are what the findings
 * strip shows the writer, so naming the same thing in both places is what lets a
 * writer ask "why did you leave that em-dash" and be understood.
 */
function rulesBlock(voice: ResolvedVoice): string {
  const moved = THRESHOLD_KEYS.filter(function (key) {
    return voice.thresholds[key] !== DEFAULT_VOICE_THRESHOLDS[key];
  }).map(function (key) {
    return `${key} ${voice.thresholds[key]}`;
  });

  return `## Voice rules in force

${voice.detectors.length === 0 ? 'None. The writer turned every rule off.' : voice.detectors.join(', ')}

Prose you write for this document should not trip them.${
    moved.length === 0 ? '' : `\n\nThresholds this document moved: ${moved.join(', ')}.`
  }`;
}

/** One level of the cascade's prose, whole, as its author wrote it. */
function guidanceBlock(guidance: string): string {
  return `## The writer's guidance

${guidance.trim()}`;
}

function documentBlock(context: AgentContext): string {
  const doc = context.doc;
  if (doc === undefined) return '## The document\n\nNothing is open.';

  return `## The document

${doc.title} (${doc.path})

${doc.source}`;
}

function selectionBlock(selection: string | undefined): string {
  if (selection === undefined) return '## Selection\n\nThe writer has nothing selected.';

  return `## Selection

The writer highlighted this:

${selection}`;
}

/**
 * One reference, in the order `assembleReferences` put it.
 *
 * A link carries a title and an address and nothing else, which is the whole of
 * what phase 4 promises: retrieval is phase 5. A reference whose file the vault
 * has lost says so rather than arriving as an empty body the agent would read as
 * a blank document.
 */
function referenceBlock(entry: ContextReference): string {
  const where =
    entry.origin.level === 'group' ? `inherited from ${entry.origin.group}` : 'attached';
  const head = `## Reference: ${entry.title} (${entry.kind}, ${where})`;

  if (entry.kind === 'link') return `${head}\n\n${entry.target}\n\nNot fetched.`;
  if (entry.missing) return `${head}\n\n${entry.target}\n\nThis file is no longer in the vault.`;
  if (entry.source.length === 0)
    return `${head}\n\n${entry.target}\n\nTurned off for this document.`;
  return `${head}\n\n${entry.target}\n\n${entry.source}`;
}

/** A reference the writer detached or turned off since the last turn. */
function detachedBlock(entry: ContextReference): string {
  return `## Reference removed: ${entry.title}

The writer took this out of the context. Do not go on relying on it.`;
}

function messageBlock(message: string): string {
  return `## The writer says

${message}`;
}

/** Blocks separated by a blank line, with the empty ones dropped. */
function blocks(parts: readonly string[]): string {
  return parts
    .filter(function (part) {
      return part.trim().length > 0;
    })
    .join('\n\n');
}

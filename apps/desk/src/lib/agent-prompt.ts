import {DEFAULT_VOICE_THRESHOLDS, type ResolvedVoice, type VoiceThresholds} from '@inkling/voice';
import type {AgentContext} from './agent.ts';
import type {Pointer} from './pointer.ts';
import type {ContextReference} from './references.ts';
import {FENCE} from './reply.ts';

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
 * message of a long conversation. The turn block is the second exception, for
 * the same reason and a stronger one: which of the two edit kinds is legal
 * changes between one turn and the next, so a stale copy is a wrong copy.
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

The document is written by turns, and every message tells you whose turn it is.
On the writer's turn you propose a change and they accept or reject it. On your
own turn you say what the change is and inkling makes it for you. You never edit
the file yourself, on either turn.`;

/** Everything the first turn of a session needs. */
export type OpeningTurn = {
  voice: ResolvedVoice;
  context: AgentContext;
  /** Whether this turn may change the document. See `docs/turn-taking.md`. */
  authorized: boolean;
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
  /** Whether this turn may change the document. See `docs/turn-taking.md`. */
  authorized: boolean;
  message: string;
};

/**
 * The first turn: everything the agent needs to know, once.
 *
 * The order is deliberate. Rules and guidance come before the prose so they read
 * as instructions about what follows rather than as an afterthought, and the
 * writer's message comes last so it is the freshest thing in the context.
 */
export function openingPrompt({voice, context, authorized, message}: OpeningTurn): string {
  return blocks([
    rulesBlock(voice),
    ...voice.guidance.map(guidanceBlock),
    CONTRACT_BLOCK,
    turnBlock(authorized),
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
  authorized,
  message,
}: FollowUpTurn): string {
  const draftMoved = context.doc?.source !== previous.doc?.source;
  // The quote, never the pointer. Two selections of the same words are two
  // objects, so comparing them would re-send the selection block every turn for
  // the rest of the conversation.
  const selectionMoved = context.selection?.quote !== previous.selection?.quote;

  return blocks([
    rulesBlock(voice),
    turnBlock(authorized),
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
 * The reply contract, sent once at the top of a session.
 *
 * It is long, and it does not change between turns, so it goes with the rest of
 * the once-only material. What does change is which kind is legal, and that is
 * {@link turnBlock}, which is short enough to re-send every turn.
 */
const CONTRACT_BLOCK = `## How to reply

Ordinary prose, unless the reply changes the document, asks to, or points at a
passage in it. When it does, end the reply with one fenced block, and put
nothing after it:

${FENCE}
{"kind": "proposed", "quote": "the passage exactly as it stands now", "replacement": "what goes there instead"}
\`\`\`

- \`kind\` is \`made\` when you are changing the document and \`proposed\` when you
  are asking to. The turn tells you which one is legal.
- \`quote\` is the passage to replace, copied from the document exactly, and long
  enough to appear in it only once. An edit whose quote inkling cannot find, or
  finds twice, is refused and the writer is told why.
- \`replacement\` is what goes there instead. An empty string deletes the passage.
- One block, about one passage. A reply carrying two is refused whole.
- The writer never sees the block. Say what you did, what you are asking to do,
  or what you are pointing at, in the prose above it.

To point at a passage without changing it, send this instead:

${FENCE}
{"kind": "point", "quote": "the passage exactly as it stands now"}
\`\`\`

- The same quote rule: copied exactly, and long enough to appear only once.
- No \`replacement\`. A point changes nothing, and is legal on either turn.
- Naming the passage beats describing where it is. "The third paragraph" is
  something the writer has to go and count; a quote is something inkling can
  scroll to and highlight for them.`;

/**
 * Which of the two edit kinds is legal on this turn, and what the other one
 * costs. Short on purpose: it goes in every turn, opening and follow-up alike,
 * because a stale copy of it is a wrong copy.
 */
function turnBlock(authorized: boolean): string {
  if (authorized) {
    return `## Whose turn it is

Yours. You may change the document: send \`"kind": "made"\` and inkling writes it
to the file, then reads the file back. Propose instead if you would rather ask.`;
  }

  return `## Whose turn it is

The writer's. Do not change the document. If you want it changed, propose the
change with \`"kind": "proposed"\` and they will accept or reject it. A block
claiming \`"kind": "made"\` on this turn is refused and applied to nothing.`;
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

/** What the writer highlighted, as its own words. Where it was is inkling's. */
function selectionBlock(selection: Pointer | undefined): string {
  if (selection === undefined) return '## Selection\n\nThe writer has nothing selected.';

  return `## Selection

The writer highlighted this:

${selection.quote}`;
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

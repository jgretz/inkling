import {Fragment, memo, useCallback, useEffect, useRef, useState} from 'react';
import type {ChangeEvent, FocusEvent, KeyboardEvent} from 'react';
import {match} from 'ts-pattern';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up';
import Square from 'lucide-react/dist/esm/icons/square';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import type {DocPath} from '@inkling/vault';
import type {AgentContext, AgentTransport, Message, Role} from '../../lib/agent.ts';
import type {Conversation} from '../../lib/conversations.ts';
import {pointerFor, type Miss, type Pointer} from '../../lib/pointer.ts';
import type {AgentReply, Edit} from '../../lib/reply.ts';
import type {TurnMode} from '../../lib/turn.ts';
import {Splitter} from '../shell/Splitter.tsx';
import {ContextStrip, type ReferenceControls} from './ContextStrip.tsx';

/** The conversations of the open document, and how the writer moves between them. */
export type ConversationControls = {
  all: readonly Conversation[];
  activeId: number | undefined;
  onSelect: (id: number) => void;
  onCreate: () => void;
  /**
   * Ends the active conversation and everything said in it.
   *
   * The asking is the caller's, not the panel's: a conversation takes its turns
   * with it and nothing puts them back, so `App.tsx` confirms first. Keeping the
   * dialog out here is also what leaves this component drivable with no webview.
   */
  onDelete: () => void;
};

type ChatPanelProps = {
  transport: AgentTransport;
  context: AgentContext;
  /** Attaching and detaching, which happens in the context strip and nowhere else. */
  references: ReferenceControls;
  /**
   * The active conversation's stored turns, seeding the message list.
   *
   * Read once, at mount. The panel owns its history from that point, which is
   * why `App.tsx` gives it a `key` of the conversation id: switching remounts
   * rather than merging one conversation's messages into another's.
   */
  initial: Message[];
  conversations: ConversationControls;
  /**
   * Whose turn it is as of this render. Read once at the top of a send and not
   * afterwards: a turn authorized when it left stays authorized.
   */
  mode: TurnMode;
  /** Awaited before an authorized turn leaves, so disk matches the buffer. */
  onFlush: () => Promise<void>;
  /** A proposal the writer accepted. The caller applies it to the buffer. */
  onAccept: (edit: Edit) => void;
  /**
   * An edit the agent made on its own turn, with the document the turn was
   * about. The caller lands it on disk, and the path is what lets it refuse
   * when the writer moved to another document while the agent was thinking.
   */
  onLand: (edit: Edit, path: DocPath | undefined) => void;
  /**
   * A passage in the transcript the writer asked to see. The caller resolves it
   * against the draft as it stands now and reveals it, or says it has gone.
   */
  onPoint: (pointer: Pointer) => void;
  /** Fires when focus lands in the panel anywhere but the composer. */
  onFocus: () => void;
  /** Height of the message box, in pixels, and how the writer changes it. */
  composerHeight: number;
  onResizeComposer: (height: number) => void;
};

/**
 * What became of a reply, for the replies that leave something on screen.
 *
 * An answer leaves nothing, and an edit made goes straight to the caller, so
 * neither is here. Kept beside the messages rather than on them because
 * `Message` is also the shape a stored turn comes back as, and none of this
 * survives a restart: a proposal is answered in the session that raised it.
 *
 * A pointer is the exception that proves it. It is here while the turn is live,
 * and `messagesOf` rebuilds it from the stored reply on the way back in, so a
 * transcript read a week later still points.
 */
type Outcome =
  | {kind: 'proposed'; edit: Edit}
  | {kind: 'point'; pointer: Pointer}
  | {kind: 'refused'; reason: string};

/** The value of the switcher's last entry, which is not a conversation id. */
const NEW_CONVERSATION = 'new';

let counter = 0;

/** Monotonic within a session, which is all a React key needs. */
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

function Bubble({message}: {message: Message}) {
  const mine = message.role === 'writer';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`selectable max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
          mine ? 'bg-ink-700 text-ink-50' : 'bg-ink-850 text-ink-200'
        }`}
      >
        {message.text}
        {message.pending === true && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" />
        )}
      </div>
    </div>
  );
}

type ProposalProps = {
  /** The message the proposal came in on, so accepting one answers only it. */
  id: string;
  edit: Edit;
  onAccept: (id: string, edit: Edit) => void;
  onReject: (id: string) => void;
};

/**
 * A proposed edit, as the replacement passage and the passage it replaces.
 *
 * Both halves, rather than the replacement alone: the writer is being asked to
 * agree to a swap, and half a swap is not something anyone can answer. A
 * rendered diff would say the same thing at greater length and is a non-goal.
 */
const Proposal = memo(function Proposal({id, edit, onAccept, onReject}: ProposalProps) {
  const accept = useCallback(
    function () {
      onAccept(id, edit);
    },
    [id, edit, onAccept],
  );
  const reject = useCallback(
    function () {
      onReject(id);
    },
    [id, onReject],
  );

  return (
    <div className="max-w-[85%] space-y-1.5 rounded-xl border border-ink-800 bg-ink-900 p-2.5 text-[12px] leading-relaxed">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-500">Replace</p>
      <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-ink-400 line-through">
        {edit.quote}
      </p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-500">With</p>
      {edit.replacement.length === 0 ? (
        <p className="italic text-ink-500">Nothing. The passage would be cut.</p>
      ) : (
        <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-ink-100">
          {edit.replacement}
        </p>
      )}
      <div className="flex gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={accept}
          className="rounded-md bg-accent px-2 py-1 text-[12px] text-ink-950 transition-opacity duration-100 hover:opacity-90"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={reject}
          className="rounded-md px-2 py-1 text-[12px] text-ink-400 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
        >
          Reject
        </button>
      </div>
    </div>
  );
});

/**
 * Why a pointer's quote could not be placed, in the notice's register.
 *
 * A clause rather than a sentence, because {@link Refusal} has already begun
 * one: everything the validator hands it ("its block was never closed") reads
 * as the end of "Inkling did not act on this reply: …", and a miss that arrived
 * as a capitalised sentence would be the one thing there that did not.
 */
const POINT_MISS: Record<Miss, string> = {
  missing: 'the passage it quoted is not in the document the turn carried',
  ambiguous: 'the passage it quoted appears more than once there, so which one it meant is unclear',
};

/**
 * A reply inkling would not act on, in the words of whatever refused it.
 *
 * A notice and nothing more: there is deliberately nothing here to accept,
 * because the whole reason the reply was refused is that what it asked for
 * could not be read. A pointer whose passage is not in the document the turn
 * carried lands here too, for the same reason and in the same place, phrased by
 * {@link POINT_MISS} rather than by the validator.
 */
const Refusal = memo(function Refusal({reason}: {reason: string}) {
  return (
    <p
      role="status"
      className="max-w-[85%] rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[12px] leading-relaxed text-amber-300"
    >
      Inkling did not act on this reply: {reason}
    </p>
  );
});

type ReferenceProps = {
  pointer: Pointer;
  /** Whose passage it is, which is the whole of what the label has to say. */
  role: Role;
  onPoint: (pointer: Pointer) => void;
};

/**
 * A passage somebody pointed at, as the words themselves and a way back to them.
 *
 * The quote is what it shows, never an offset or a paragraph number: the writer
 * has gone on editing since, and the only thing that stayed true is the text.
 * Clicking resolves it against the draft as it stands now, so a passage that has
 * since moved is found and one that has gone is said to have gone.
 */
const Reference = memo(function Reference({pointer, role, onPoint}: ReferenceProps) {
  const mine = role === 'writer';
  const show = useCallback(
    function () {
      onPoint(pointer);
    },
    [pointer, onPoint],
  );

  const lead = mine ? 'Show the passage you selected' : 'Show the passage the agent pointed at';

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <button
        type="button"
        onClick={show}
        // The quote is in the accessible name, not only on screen. Without it a
        // screen reader is offered a button to show a passage and never told
        // which passage, which is the one thing the control is about.
        aria-label={`${lead}: ${pointer.quote}`}
        className="max-w-[85%] space-y-1 rounded-lg border-l-2 border-accent-muted bg-ink-900 py-1.5 pl-2.5 pr-3 text-left text-[12px] leading-relaxed text-ink-400 transition-colors duration-100 hover:bg-ink-850 hover:text-ink-200"
      >
        <span className="block text-[10px] font-medium uppercase tracking-wider text-ink-500">
          {mine ? 'Selected' : 'Pointed at'}
        </span>
        <span className="line-clamp-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {pointer.quote}
        </span>
      </button>
    </div>
  );
});

/**
 * The conversation. Owns its own history rather than lifting it into the
 * workspace: a chat is about a document but is not part of it, and nothing in
 * the editor or preview should re-render because a reply streamed in.
 */
export function ChatPanel({
  transport,
  context,
  references,
  initial,
  conversations,
  mode,
  onFlush,
  onAccept,
  onLand,
  onPoint,
  onFocus,
  composerHeight,
  onResizeComposer,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(
    function () {
      tail.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
    },
    [messages],
  );

  // A live ref so the send handler reads the context as it is at send time,
  // without re-creating on every keystroke in the editor.
  const contextRef = useRef(context);
  contextRef.current = context;
  const historyRef = useRef(messages);
  historyRef.current = messages;

  const stop = useCallback(function () {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setMessages(function (current) {
      return current.map(function (message) {
        return message.pending === true ? {...message, pending: false} : message;
      });
    });
  }, []);

  /**
   * What a turn's one parsed reply leaves behind, if it leaves anything.
   *
   * `snapshot` is the context the turn was sent with, and every quote in the
   * reply is read against it rather than against whatever is open now: the agent
   * quoted the document it was given, and two documents made from one template
   * share passages.
   */
  const receive = useCallback(
    function (replyId: string, reply: AgentReply, snapshot: AgentContext): void {
      match(reply)
        // Prose, already on screen from the chunks it streamed in as.
        .with({kind: 'answer'}, function () {})
        .with({kind: 'made'}, function ({edit}) {
          onLand(edit, snapshot.doc?.path);
        })
        .with({kind: 'proposed'}, function ({edit}) {
          setOutcomes(function (current) {
            return {...current, [replyId]: {kind: 'proposed', edit}};
          });
        })
        .with({kind: 'point'}, function ({quote}) {
          const found = pointerFor(snapshot.doc?.source ?? '', quote);
          setOutcomes(function (current) {
            return {
              ...current,
              [replyId]: found.ok
                ? {kind: 'point', pointer: found.value}
                : {kind: 'refused', reason: POINT_MISS[found.miss]},
            };
          });
        })
        .with({kind: 'refused'}, function ({reason}) {
          setOutcomes(function (current) {
            return {...current, [replyId]: {kind: 'refused', reason}};
          });
        })
        .exhaustive();
    },
    [onLand],
  );

  /** Takes the proposal off screen, whichever way it was answered. */
  const settle = useCallback(function (replyId: string): void {
    setOutcomes(function (current) {
      const {[replyId]: _answered, ...rest} = current;
      return rest;
    });
  }, []);

  const accept = useCallback(
    function (replyId: string, edit: Edit) {
      onAccept(edit);
      settle(replyId);
    },
    [onAccept, settle],
  );

  const send = useCallback(
    async function () {
      const text = input.trim();
      if (text.length === 0 || busy) return;

      // Read once, here, before anything awaits. Everything after this line may
      // run while the writer moves focus, and a turn authorized when it left
      // stays authorized: re-deriving mid-flight is a race, and the race is
      // worse than the edge case.
      const authorized = mode === 'agent';
      // One snapshot, read here for the same reason: an edit belongs to the
      // document the turn actually carried, whatever is open by the time it
      // comes back, and the two cannot disagree if they are the same read.
      const snapshot = contextRef.current;

      const writerMessage: Message = {
        id: nextId(),
        role: 'writer',
        text,
        at: new Date().toISOString(),
        // What they had highlighted when they pressed send, so the transcript
        // shows what the question was about and can show it again.
        ...(snapshot.selection === undefined ? {} : {pointer: snapshot.selection}),
      };
      const replyId = nextId();
      setMessages(function (current) {
        return [
          ...current,
          writerMessage,
          {id: replyId, role: 'agent', text: '', at: new Date().toISOString(), pending: true},
        ];
      });
      setInput('');
      setBusy(true);

      const controller = new AbortController();
      abort.current = controller;

      try {
        // Before the turn leaves, never after: an authorized turn may read the
        // file, and it should read what the writer is looking at rather than
        // whatever the autosave last got round to.
        if (authorized) await onFlush();

        const turn = {
          message: text,
          context: snapshot,
          history: historyRef.current,
          authorized,
        };
        for await (const chunk of transport.send(turn, controller.signal)) {
          if (chunk.kind === 'reply') {
            receive(replyId, chunk.reply, snapshot);
            continue;
          }
          const {text: piece} = chunk;
          setMessages(function (current) {
            return current.map(function (message) {
              return message.id === replyId ? {...message, text: message.text + piece} : message;
            });
          });
        }
      } catch (error) {
        console.error('inkling: the agent turn failed', error);
        const detail = error instanceof Error ? error.message : String(error);
        setMessages(function (current) {
          return current.map(function (message) {
            return message.id === replyId ? {...message, text: `Failed: ${detail}`} : message;
          });
        });
      } finally {
        abort.current = null;
        setBusy(false);
        setMessages(function (current) {
          return current.map(function (message) {
            return message.id === replyId ? {...message, pending: false} : message;
          });
        });
      }
    },
    [busy, input, transport, mode, onFlush, receive],
  );

  const handleKey = useCallback(
    function (event: KeyboardEvent<HTMLTextAreaElement>) {
      // Enter sends; Shift+Enter is a newline. A composer is not a document.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void send();
      }
    },
    [send],
  );

  const handleInput = useCallback(function (event: ChangeEvent<HTMLTextAreaElement>) {
    setInput(event.target.value);
  }, []);

  const handleFocus = useCallback(
    function (event: FocusEvent<HTMLElement>) {
      // The composer is neutral. Typing a message is not a claim on the turn:
      // a writer whose cursor is in the document types their question here and
      // still expects to be asked before anything changes under them.
      if (event.target === composer.current) return;
      onFocus();
    },
    [onFocus],
  );

  const {onSelect, onCreate} = conversations;
  const handleSwitch = useCallback(
    function (event: ChangeEvent<HTMLSelectElement>) {
      const picked = event.target.value;
      if (picked === NEW_CONVERSATION) onCreate();
      else onSelect(Number(picked));
    },
    [onSelect, onCreate],
  );

  return (
    <section
      onFocusCapture={handleFocus}
      className="flex h-full min-w-0 flex-col border-l border-ink-800 bg-ink-950"
    >
      <div className="flex shrink-0 items-baseline justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Agent</span>
        <span className="text-[10px] text-ink-600">{transport.name}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <select
          value={conversations.activeId ?? ''}
          onChange={handleSwitch}
          aria-label="Conversation"
          className="min-w-0 flex-1 rounded-md bg-ink-850 px-2 py-1 text-[12px] text-ink-200 focus:outline-none focus:ring-1 focus:ring-accent-muted"
        >
          {conversations.all.map(function (entry) {
            return (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            );
          })}
          <option value={NEW_CONVERSATION}>New conversation</option>
        </select>
        {/* Off for the last one: the panel needs a conversation to put the next
            turn in, and deleting it would leave the writer typing into nothing. */}
        <button
          type="button"
          onClick={conversations.onDelete}
          disabled={conversations.all.length <= 1}
          aria-label="Delete conversation"
          className="shrink-0 rounded p-1 text-ink-600 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200 disabled:pointer-events-none disabled:opacity-30"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <p className="px-1 py-8 text-center text-[12px] leading-relaxed text-ink-600">
            Ask for a rewrite, an outline, or a second opinion. What the agent can see is listed
            below.
          </p>
        ) : (
          messages.map(function (message) {
            const outcome = outcomes[message.id];
            return (
              <Fragment key={message.id}>
                <Bubble message={message} />
                {/* The writer's own selection, and a stored reply's pointer,
                    both arrive on the message. A live reply's arrives as an
                    outcome, because it is built when the reply is parsed. */}
                {message.pointer !== undefined && (
                  <Reference pointer={message.pointer} role={message.role} onPoint={onPoint} />
                )}
                {outcome?.kind === 'point' && (
                  <Reference pointer={outcome.pointer} role={message.role} onPoint={onPoint} />
                )}
                {outcome?.kind === 'proposed' && (
                  <Proposal
                    id={message.id}
                    edit={outcome.edit}
                    onAccept={accept}
                    onReject={settle}
                  />
                )}
                {outcome?.kind === 'refused' && <Refusal reason={outcome.reason} />}
              </Fragment>
            );
          })
        )}
        <div ref={tail} />
      </div>

      <ContextStrip context={context} references={references} />

      {/* On the top edge, because the box is already at the bottom of the panel
          and the only room it has to grow is upwards. A corner grip below it
          would pull toward the one direction there is no space in. */}
      <Splitter
        size={composerHeight}
        onResize={onResizeComposer}
        side="bottom"
        min={64}
        max={480}
        label="Resize the message box"
      />

      <div className="shrink-0 p-2">
        <div className="flex items-end gap-2 rounded-lg bg-ink-850 p-2 focus-within:ring-1 focus-within:ring-accent-muted">
          <textarea
            ref={composer}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKey}
            placeholder="Message the agent"
            aria-label="Message the agent"
            style={{height: composerHeight}}
            // The handle above owns the height, so the native grip is off. A
            // writer briefing an agent on a piece writes paragraphs, and the
            // two rows this used to be turned that into a porthole with the top
            // of their own message scrolled out of sight.
            className="selectable flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink-100 placeholder:text-ink-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={busy ? stop : send}
            disabled={!busy && input.trim().length === 0}
            aria-label={busy ? 'Stop generating' : 'Send message'}
            className="rounded-md bg-accent p-1.5 text-ink-950 transition-opacity duration-100 hover:opacity-90 disabled:opacity-30"
          >
            {busy ? <Square size={13} /> : <ArrowUp size={13} />}
          </button>
        </div>
      </div>
    </section>
  );
}

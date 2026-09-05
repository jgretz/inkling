import {useCallback, useEffect, useRef, useState} from 'react';
import type {ChangeEvent, KeyboardEvent} from 'react';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up';
import Square from 'lucide-react/dist/esm/icons/square';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import type {AgentContext, AgentTransport, Message} from '../../lib/agent.ts';
import type {Conversation} from '../../lib/conversations.ts';
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
};

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
        className={`selectable max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
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
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement>(null);

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

  const send = useCallback(
    async function () {
      const text = input.trim();
      if (text.length === 0 || busy) return;

      const writerMessage: Message = {
        id: nextId(),
        role: 'writer',
        text,
        at: new Date().toISOString(),
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
        const turn = {
          message: text,
          context: contextRef.current,
          history: historyRef.current,
        };
        for await (const chunk of transport.send(turn, controller.signal)) {
          setMessages(function (current) {
            return current.map(function (message) {
              return message.id === replyId ? {...message, text: message.text + chunk} : message;
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
    [busy, input, transport],
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
    <section className="flex h-full min-w-0 flex-col border-l border-ink-800 bg-ink-950">
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
            return <Bubble key={message.id} message={message} />;
          })
        )}
        <div ref={tail} />
      </div>

      <ContextStrip context={context} references={references} />

      <div className="shrink-0 border-t border-ink-800 p-2">
        <div className="flex items-end gap-2 rounded-lg bg-ink-850 p-2 focus-within:ring-1 focus-within:ring-accent-muted">
          <textarea
            value={input}
            onChange={handleInput}
            onKeyDown={handleKey}
            rows={2}
            placeholder="Message the agent"
            aria-label="Message the agent"
            className="selectable max-h-40 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink-100 placeholder:text-ink-600 focus:outline-none"
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

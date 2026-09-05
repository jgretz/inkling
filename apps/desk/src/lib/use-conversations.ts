import {useCallback, useEffect, useRef, useState} from 'react';
import type {DocPath} from '@inkling/vault';
import type {HeldSessionState} from '@inkling/toryo';
import type {Message} from './agent.ts';
import {
  DEFAULT_TITLE,
  messagesOf,
  pendingTurn,
  type Conversation,
  type ConversationStore,
} from './conversations.ts';

/**
 * The open document's conversations, and the messages of whichever one is
 * active.
 *
 * Shaped like `use-references.ts`: state so the panel reacts to a click rather
 * than to a round trip, every write going to the database and updating the state
 * from what came back, and a vault whose database will not open leaving this
 * empty with every action a no-op. That is the same degradation `dataNotice`
 * explains in the status bar.
 *
 * Unlike the references, this reads per document rather than the whole table. A
 * conversation carries its turns, a vault accumulates them for as long as the
 * writer keeps writing, and only one document's are ever on screen.
 *
 * ## Why a pending turn is always interrupted, whatever the session says
 *
 * A held session's event stream has NO backlog: a subscriber is sent `hello` and
 * then only frames that arrive after it connected. So a reply that landed while
 * inkling was closed cannot be recovered, and that is true of a session the
 * daemon still calls `live` as much as one it evicted. Rendering the turn as an
 * answer would mean inventing one, and leaving it pending would mean a caret
 * blinking against a stream nobody is reading.
 *
 * What the session's state does decide is whether the CONVERSATION keeps it. A
 * live session is still the one to push the next message into; anything else is
 * demoted to a resume id, and the next turn opens a new session with it.
 */

export type Conversations = {
  /** Every conversation about the open document, oldest first. */
  all: readonly Conversation[];
  active: Conversation | undefined;
  /** The active conversation's stored turns, as the panel renders them. */
  initial: Message[];
  /** False until the active conversation's history has been read. */
  loaded: boolean;
  /** Starts another conversation about the same document, and makes it active. */
  create: () => void;
  select: (id: number) => void;
  remove: (id: number) => void;
};

type Options = {
  store: ConversationStore;
  /** The open document, which owns its conversations. */
  docPath: DocPath | undefined;
  /** Whether the vault database is open. */
  ready: boolean;
  /**
   * What the daemon says about a session, or undefined when it cannot be reached
   * or has never heard of it. Injected rather than reached for, so this hook is
   * drivable with no daemon.
   */
  sessionState: (sessionId: string) => Promise<HeldSessionState | undefined>;
};

/** The name the next conversation about a document gets. */
function nextTitle(existing: readonly Conversation[]): string {
  return existing.length === 0 ? DEFAULT_TITLE : `${DEFAULT_TITLE} ${existing.length + 1}`;
}

export function useConversations({store, docPath, ready, sessionState}: Options): Conversations {
  const [all, setAll] = useState<readonly Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | undefined>(undefined);
  const [initial, setInitial] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Held in a ref rather than read as a dependency: the turns effect needs the
  // active conversation's session id, and depending on the list would re-read
  // every turn each time a title changed.
  const allRef = useRef(all);
  allRef.current = all;

  // The probe is held the same way, and for a sharper reason: it is a callback,
  // so a caller that writes one inline hands this hook a new identity on every
  // render. As a dependency that is an effect that re-runs forever.
  const probeRef = useRef(sessionState);
  probeRef.current = sessionState;

  useEffect(
    function () {
      // Emptied first: without this, one document's conversations would be on
      // screen for the next one for as long as the read took.
      setAll([]);
      setActiveId(undefined);
      if (docPath === undefined || !ready) return;

      let live = true;
      store
        .list(docPath)
        .then(async function (rows) {
          if (!live) return;
          if (rows.length > 0) {
            setAll(rows);
            setActiveId(rows[rows.length - 1]?.id);
            return;
          }
          // A document with no conversation gets one rather than a panel that
          // cannot be typed into. It costs a row and no prose.
          const started = await store.create(docPath, DEFAULT_TITLE);
          if (!live) return;
          setAll([started]);
          setActiveId(started.id);
        })
        .catch(function (error) {
          console.warn(`inkling: could not read the conversations for ${docPath}`, error);
        });
      return function () {
        live = false;
      };
    },
    [store, docPath, ready],
  );

  useEffect(
    function () {
      setInitial([]);
      setLoaded(false);
      if (activeId === undefined) return;

      let live = true;
      void (async function () {
        const turns = await store.listTurns(activeId);
        const pending = pendingTurn(turns);
        if (pending === undefined) {
          if (live) {
            setInitial(messagesOf(turns));
            setLoaded(true);
          }
          return;
        }

        const held = allRef.current.find(function (entry) {
          return entry.id === activeId;
        })?.sessionId;
        const state =
          held === null || held === undefined ? undefined : await probeRef.current(held);
        if (held !== null && held !== undefined && state !== 'live') {
          await store.setSession(activeId, null, held);
          if (live) {
            setAll(function (current) {
              return current.map(function (entry) {
                return entry.id === activeId
                  ? {...entry, sessionId: null, resumeSessionId: held}
                  : entry;
              });
            });
          }
        }

        const finished = await store.finishTurn(pending.id, 'interrupted', null);
        if (!live) return;
        setInitial(
          messagesOf(
            turns.map(function (turn) {
              return turn.id === finished.id ? finished : turn;
            }),
          ),
        );
        setLoaded(true);
      })().catch(function (error) {
        console.warn(`inkling: could not read conversation ${activeId}`, error);
      });

      return function () {
        live = false;
      };
    },
    [store, activeId],
  );

  const create = useCallback(
    function () {
      if (docPath === undefined || !ready) return;
      store
        .create(docPath, nextTitle(allRef.current))
        .then(function (started) {
          setAll(function (current) {
            return [...current, started];
          });
          setActiveId(started.id);
        })
        .catch(function (error) {
          console.warn('inkling: could not start a conversation', error);
        });
    },
    [store, docPath, ready],
  );

  const select = useCallback(function (id: number) {
    setActiveId(id);
  }, []);

  const remove = useCallback(
    function (id: number) {
      if (!ready) return;
      store
        .remove(id)
        .then(function () {
          const left = allRef.current.filter(function (entry) {
            return entry.id !== id;
          });
          setAll(left);
          // The one before it, so deleting the newest lands on the previous
          // conversation rather than on nothing.
          setActiveId(left[left.length - 1]?.id);
        })
        .catch(function (error) {
          console.warn(`inkling: could not delete conversation ${id}`, error);
        });
    },
    [store, ready],
  );

  const active = all.find(function (entry) {
    return entry.id === activeId;
  });

  return {all, active, initial, loaded, create, select, remove};
}

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {confirm, open, save} from '@tauri-apps/plugin-dialog';
import {groupOf, parseDoc, type DocPath, type VaultPath} from '@inkling/vault';
import {resolveVoice, type Finding} from '@inkling/voice';
import {createHeldSessionClient} from '@inkling/toryo';
import {
  exportDoc,
  isDesktop,
  loadSettings,
  saveSettings,
  tauriConversations,
} from './lib/bridge.ts';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type LayoutSettings,
  type ToggleKey,
} from './lib/settings.ts';
import type {AgentContext} from './lib/agent.ts';
import {copyRichText, systemClipboard} from './lib/clipboard.ts';
import {daemonToken, initDaemonToken, refreshDaemonToken} from './lib/daemon-token.ts';
import {createDispatchTransport, type TokenAccess} from './lib/dispatch-transport.ts';
import {
  defaultExportPath,
  exportDirectory,
  exportFileName,
  exportSource,
  type FrontmatterChoice,
} from './lib/export.ts';
import {resolvePointer, type Pointer} from './lib/pointer.ts';
import {assembleReferences} from './lib/references.ts';
import {applyEdit, type Edit} from './lib/reply.ts';
import {docToHtml} from './lib/rich-text.tsx';
import {cyclePin, deriveMode, indicatorFor, type FocusRegion} from './lib/turn.ts';
import {useConversations} from './lib/use-conversations.ts';
import {useFindings} from './lib/use-findings.ts';
import {useReferences} from './lib/use-references.ts';
import {useSuppressions} from './lib/use-suppressions.ts';
import {useWorkspace} from './lib/use-workspace.ts';
import {cascadeFor, voiceNotice} from './lib/voice-cascade.ts';
import {dataNotice} from './lib/workspace-state.ts';
import {TitleBar} from './components/shell/TitleBar.tsx';
import {StatusBar} from './components/shell/StatusBar.tsx';
import {Splitter} from './components/shell/Splitter.tsx';
import {EmptyState} from './components/shell/EmptyState.tsx';
import {LibraryPanel} from './components/library/LibraryPanel.tsx';
import {PreviewPanel} from './components/preview/PreviewPanel.tsx';
import {EditorPanel, type Reveal} from './components/editor/EditorPanel.tsx';
import {FindingsStrip, type DismissedFinding} from './components/findings/FindingsStrip.tsx';
import {ChatPanel} from './components/chat/ChatPanel.tsx';
import type {ReferenceControls} from './components/chat/ContextStrip.tsx';

/** No document open, so no rule set governs anything. Held still for the memos. */
const NO_CASCADE = Object.freeze({sets: [], problems: []});

/**
 * One client for the app's whole life.
 *
 * The token is a thunk rather than a value, and the client resolves it once per
 * request, so a token the daemon rewrote takes effect without anything being
 * rebuilt. An empty string means no token to present, which is what the client
 * reads as "send no header".
 */
const DAEMON = createHeldSessionClient({
  token: function () {
    return daemonToken() ?? '';
  },
});

/** How the transport reads and re-reads the token. See `lib/daemon-token.ts`. */
const TOKEN: TokenAccess = {current: daemonToken, refresh: refreshDaemonToken};

/** Last path segment of the vault directory, which is what a writer named it. */
function vaultName(vault: VaultPath | undefined): string {
  if (vault === undefined) return 'No vault';
  return vault.split('/').filter(Boolean).pop() ?? vault;
}

export function App() {
  const workspace = useWorkspace();
  const [layout, setLayout] = useState<LayoutSettings>(DEFAULT_SETTINGS.layout);
  /** What the writer has highlighted, as a pointer. Session-scoped; nothing stores it. */
  const [selection, setSelection] = useState<Pointer | undefined>(undefined);
  const [restored, setRestored] = useState(false);
  /** Where focus last was, which is what the turn mode is derived from. */
  const [lastFocus, setLastFocus] = useState<FocusRegion | undefined>(undefined);
  /** True from the moment an agent's edit starts landing until the buffer holds disk. */
  const [landing, setLanding] = useState(false);

  const [agentError, setAgentError] = useState<string | undefined>(undefined);
  /** An export or a copy that could not happen, said the way a failed save is. */
  const [outputError, setOutputError] = useState<string | undefined>(undefined);
  /**
   * Something that went right, shown for a moment and then dropped. The counter
   * is what re-arms the timer when the same message is flashed twice, the same
   * idiom `reveal` uses for revealing the same finding twice.
   */
  const [flash, setFlash] = useState<{message: string; seq: number} | undefined>(undefined);
  /** Where the last export landed, so the next save dialog opens there. */
  const [lastExportDir, setLastExportDir] = useState<string | undefined>(undefined);

  const {chooseVault, openDoc} = workspace;

  // Read once, before the first turn can need it. It never throws: a missing
  // file, an unreadable one and no webview at all all cache no token, and the
  // transport says so when the daemon refuses.
  useEffect(function () {
    if (isDesktop()) void initDaemonToken();
  }, []);

  // Restore the previous session once, before anything else can write settings
  // back and clobber what was on disk.
  useEffect(
    function () {
      if (!isDesktop()) {
        setRestored(true);
        return;
      }
      let live = true;
      loadSettings()
        .then(function (raw) {
          if (!live) return;
          const settings = parseSettings(raw);
          setLayout(settings.layout);
          setLastExportDir(settings.lastExportDir);
          if (settings.vault !== undefined) chooseVault(settings.vault);
          if (settings.lastDoc !== undefined) openDoc(settings.lastDoc as DocPath);
        })
        .catch(function (error) {
          console.warn('inkling: could not read settings, starting fresh', error);
        })
        .finally(function () {
          if (live) setRestored(true);
        });
      return function () {
        live = false;
      };
    },
    [chooseVault, openDoc],
  );

  const vault = workspace.vault;
  const openPath = workspace.open?.path;

  useEffect(
    function () {
      if (!restored || !isDesktop()) return;
      saveSettings({vault, lastDoc: openPath, lastExportDir, layout}).catch(function (error) {
        console.warn('inkling: could not persist settings', error);
      });
    },
    [restored, vault, openPath, lastExportDir, layout],
  );

  // Cleared on a timer rather than on the next action: the writer's eyes are on
  // the document, and a line that stayed would become part of the furniture.
  useEffect(
    function () {
      if (flash === undefined) return;
      const timer = setTimeout(function () {
        setFlash(undefined);
      }, 3000);
      return function () {
        clearTimeout(timer);
      };
    },
    [flash],
  );

  const showFlash = useCallback(function (message: string) {
    setFlash(function (current) {
      return {message, seq: (current?.seq ?? 0) + 1};
    });
  }, []);

  const handleChooseVault = useCallback(
    async function () {
      if (!isDesktop()) return;
      try {
        const picked = await open({directory: true, multiple: false, title: 'Choose a vault'});
        if (typeof picked === 'string') chooseVault(picked as VaultPath);
      } catch (error) {
        console.error('inkling: the folder picker failed', error);
      }
    },
    [chooseVault],
  );

  const handleToggle = useCallback(function (key: ToggleKey) {
    setLayout(function (current) {
      return {...current, [key]: !current[key]};
    });
  }, []);

  const resize = useCallback(function (key: keyof LayoutSettings, width: number) {
    setLayout(function (current) {
      return {...current, [key]: width};
    });
  }, []);

  const resizeLibrary = useCallback(
    function (width: number) {
      resize('libraryWidth', width);
    },
    [resize],
  );
  const resizePreview = useCallback(
    function (width: number) {
      resize('previewWidth', width);
    },
    [resize],
  );
  const resizeChat = useCallback(
    function (width: number) {
      resize('chatWidth', width);
    },
    [resize],
  );

  const titles = useMemo(
    function () {
      return new Map(
        workspace.docs.map(function (doc): [DocPath, string] {
          return [doc.path, doc.title];
        }),
      );
    },
    [workspace.docs],
  );

  // Memoised because `useReferences` re-reads the stored rows whenever this
  // list changes: a new one means the vault was scanned, and a scan follows the
  // rename that moved the paths those rows hold.
  const docPaths = useMemo(
    function () {
      return workspace.docs.map(function (doc) {
        return doc.path;
      });
    },
    [workspace.docs],
  );

  const dataReady = workspace.data.kind === 'ready';
  const references = useReferences({
    vault,
    docPath: openPath,
    ready: dataReady,
    taken: docPaths,
    onNoteWritten: workspace.refresh,
  });

  // The vault scan already read every body, so a reference is a map lookup
  // rather than a file read. See the note on `list_docs` in
  // `src-tauri/src/vault.rs`.
  const context: AgentContext = useMemo(
    function () {
      const draft = workspace.open?.draft;
      const path = workspace.open?.path;
      return {
        doc:
          path === undefined || draft === undefined
            ? undefined
            : {path, title: titles.get(path) ?? path, source: draft},
        selection,
        references: assembleReferences(
          path,
          references.rows,
          workspace.sources,
          references.suppressions,
        ),
      };
    },
    [
      workspace.open?.draft,
      workspace.open?.path,
      workspace.sources,
      titles,
      selection,
      references.rows,
      references.suppressions,
    ],
  );

  const referenceControls: ReferenceControls = useMemo(
    function () {
      return {
        docs: workspace.docs,
        group: openPath === undefined ? undefined : groupOf(openPath),
        // Nowhere to store a reference and nothing to attach it to, so the
        // strip shows no controls at all rather than ones that fail silently.
        canAttach: dataReady && openPath !== undefined,
        onAttach: references.attach,
        onDetach: references.detach,
        onSuppress: references.suppress,
        onRestore: references.restore,
      };
    },
    [
      workspace.docs,
      openPath,
      dataReady,
      references.attach,
      references.detach,
      references.suppress,
      references.restore,
    ],
  );

  const draft = workspace.open?.draft ?? '';
  const title = openPath === undefined ? 'Inkling' : (titles.get(openPath) ?? openPath);

  // Every level of the cascade is already in `workspace.sources`, so this is a
  // handful of map lookups and one frontmatter parse per level, not a read.
  const cascade = useMemo(
    function () {
      if (openPath === undefined) return NO_CASCADE;
      return cascadeFor(openPath, draft, workspace.sources);
    },
    [openPath, draft, workspace.sources],
  );

  const voice = useMemo(
    function () {
      return resolveVoice(cascade.sets);
    },
    [cascade],
  );

  const {dismissals, dismiss, restore} = useSuppressions(openPath, dataReady);
  const {kept, suppressed} = useFindings(draft, voice, dismissals);
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined);

  const sessionState = useCallback(async function (sessionId: string) {
    const known = await DAEMON.getSession(sessionId);
    return known.ok ? known.value.state : undefined;
  }, []);

  const conversations = useConversations({
    store: tauriConversations,
    docPath: openPath,
    ready: dataReady,
    sessionState,
  });

  // Read at send time rather than captured when the transport is built: the
  // writer can edit a `voice.md`, or trip a rule, between two turns of one
  // conversation, and the transport outlives both.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const firingRef = useRef(false);
  firingRef.current = kept.length > 0;

  const readVoice = useCallback(function () {
    return voiceRef.current;
  }, []);
  const readFiring = useCallback(function () {
    return firingRef.current;
  }, []);

  // Held in a ref for the reason `use-references.ts` holds `taken` in one: the
  // transport is built per conversation, and depending on the row itself would
  // rebuild it (and close its live session) every time a title or a session id
  // moved.
  const conversationRef = useRef(conversations.active);
  conversationRef.current = conversations.active;
  const conversationId = conversations.active?.id;

  const transport = useMemo(
    function () {
      const active = conversationRef.current;
      if (active === undefined || vault === undefined) return undefined;
      return createDispatchTransport({
        client: DAEMON,
        conversation: active,
        vault,
        store: tauriConversations,
        token: TOKEN,
        voice: readVoice,
        checkerFiring: readFiring,
        onError: setAgentError,
      });
    },
    [conversationId, vault, readVoice, readFiring],
  );

  // Ends the daemon session when this conversation stops being the active one,
  // keeping its id as the conversation's resume id so coming back resumes rather
  // than starts cold. A conversation that never spoke has no session and this
  // does nothing.
  useEffect(
    function () {
      if (transport === undefined) return;
      return function () {
        void transport.close();
      };
    },
    [transport],
  );

  // Asked before rather than undone after: a conversation takes every turn of it
  // through the table's cascade, and the prose either side of a session is the
  // part of this that cannot be recovered.
  const {remove: removeConversation} = conversations;
  const handleDeleteConversation = useCallback(
    function () {
      const doomed = conversationRef.current;
      if (doomed === undefined) return;
      void confirm(`Delete "${doomed.title}" and everything said in it?`, {
        title: 'Delete conversation',
        kind: 'warning',
      })
        .then(function (agreed) {
          if (agreed) removeConversation(doomed.id);
        })
        .catch(function (error) {
          console.warn('inkling: could not ask about deleting a conversation', error);
        });
    },
    [removeConversation],
  );

  const conversationControls = useMemo(
    function () {
      return {
        all: conversations.all,
        activeId: conversationId,
        onSelect: conversations.select,
        onCreate: conversations.create,
        onDelete: handleDeleteConversation,
      };
    },
    [
      conversations.all,
      conversationId,
      conversations.select,
      conversations.create,
      handleDeleteConversation,
    ],
  );

  // The counter increments on every pick because the editor honours one reveal
  // per counter value. Without it, picking the same finding twice would be the
  // same request and the second click would move nothing.
  const handlePick = useCallback(function (finding: Finding) {
    setReveal(function (current) {
      return {range: finding.range, seq: (current?.seq ?? 0) + 1};
    });
  }, []);

  const handleRestore = useCallback(
    function (entry: DismissedFinding) {
      restore(entry.by.id);
    },
    [restore],
  );

  // Held in a ref for the reason the voice cascade is: an edit is applied to
  // the draft as it stands when the reply lands, and depending on the draft
  // itself would rebuild the panel's send handler on every keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * The document, out to a file the writer picks.
   *
   * Cancelling the dialog is not a failure and says nothing at all: the writer
   * decided against it, and a line confirming that would be noise. What is said
   * is the landing and the refusal.
   */
  const handleExport = useCallback(
    async function (choice: FrontmatterChoice) {
      if (!isDesktop() || openPath === undefined) return;
      try {
        const chosen = await save({
          title: 'Export',
          defaultPath: defaultExportPath(lastExportDir, openPath),
          filters: [{name: 'Markdown', extensions: ['md']}],
        });
        if (chosen === null) return;
        await exportDoc(chosen, exportSource(draftRef.current, choice));
        setLastExportDir(exportDirectory(chosen));
        setOutputError(undefined);
        showFlash(`Exported to ${exportFileName(chosen)}`);
      } catch (error) {
        setOutputError(
          `could not export: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [openPath, lastExportDir, showFlash],
  );

  /**
   * The document, onto the clipboard as formatted text and as markdown at once.
   *
   * The plain flavour is the body rather than the buffer: someone pasting into
   * a plain-text field wants the prose, not the metadata block above it.
   */
  const handleCopy = useCallback(
    async function () {
      if (openPath === undefined) return;
      const source = draftRef.current;
      const result = await copyRichText(
        docToHtml(source),
        parseDoc(source).body,
        systemClipboard(),
      );
      if (!result.ok) {
        setOutputError(result.reason);
        return;
      }
      setOutputError(undefined);
      showFlash('Copied as rich text');
    },
    [openPath, showFlash],
  );

  const {editDraft, flush, land} = workspace;

  /** A proposal the writer accepted. Buffer only; nothing reaches disk. */
  const handleAccept = useCallback(
    function (edit: Edit) {
      const applied = applyEdit(draftRef.current, edit);
      if (!applied.ok) {
        setAgentError(applied.reason);
        return;
      }
      setAgentError(undefined);
      editDraft(applied.value);
    },
    [editDraft],
  );

  /**
   * An edit the agent made on its own turn: written, then read back.
   *
   * The transient indicator is held from here rather than from inside the
   * workspace, because what it is about is this whole round trip and not the
   * one write in the middle of it.
   */
  const handleLand = useCallback(
    function (edit: Edit, path: DocPath | undefined) {
      const applied = applyEdit(draftRef.current, edit);
      if (!applied.ok) {
        setAgentError(applied.reason);
        return;
      }
      setAgentError(undefined);
      setLanding(true);
      // `path` is the document the turn carried, and `land` refuses when it is
      // no longer the open one rather than writing into whatever took its place.
      void land(applied.value, path).finally(function () {
        setLanding(false);
      });
    },
    [land],
  );

  /**
   * A passage in the transcript the writer asked to see.
   *
   * `resolvePointer` reads the draft as it stands now, never the offsets the
   * passage had when it was pointed at, which is what lets a pointer survive
   * the paragraph above it being rewritten. A passage that is genuinely gone is
   * said to be gone, and nothing moves.
   *
   * Revealing sets the editor selection, so the passage becomes the writer's
   * selection for the next turn, and the focus the reveal takes makes it the
   * writer's turn. Both by the rules already in `turn.ts` and `EditorPanel`
   * rather than by anything decided here.
   */
  const handlePoint = useCallback(function (pointer: Pointer) {
    const found = resolvePointer(draftRef.current, pointer);
    if (!found.ok) {
      setAgentError(found.reason);
      return;
    }
    setAgentError(undefined);
    setReveal(function (current) {
      return {range: found.range, seq: (current?.seq ?? 0) + 1, mark: true};
    });
  }, []);

  const handlePin = useCallback(function () {
    setLayout(function (current) {
      return {...current, turnPin: cyclePin(current.turnPin)};
    });
  }, []);

  const handleEditorFocus = useCallback(function () {
    setLastFocus('editor');
  }, []);

  const handleChatFocus = useCallback(function () {
    setLastFocus('chat');
  }, []);

  const mode = deriveMode(lastFocus, layout.turnPin);

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        title={title}
        subtitle={vaultName(vault)}
        save={workspace.open?.save}
        layout={layout}
        onToggle={handleToggle}
        turn={indicatorFor(mode, landing)}
        pinned={layout.turnPin !== undefined}
        onPin={handlePin}
        onExport={handleExport}
        onCopy={handleCopy}
        docOpen={workspace.open !== undefined}
      />

      <main className="flex min-h-0 flex-1">
        {layout.libraryOpen && (
          <>
            <div style={{width: layout.libraryWidth}} className="shrink-0">
              <LibraryPanel
                docs={workspace.docs}
                groups={workspace.groups}
                openPath={openPath}
                vaultName={vaultName(vault)}
                onOpen={workspace.openDoc}
                onChooseVault={handleChooseVault}
                onCreateGroup={workspace.createGroup}
                onRenameGroup={workspace.renameGroup}
                onMoveDoc={workspace.moveDoc}
                onCreateDoc={workspace.createDoc}
              />
            </div>
            <Splitter
              width={layout.libraryWidth}
              onResize={resizeLibrary}
              side="left"
              min={180}
              max={420}
              label="Resize the library"
            />
          </>
        )}

        {vault === undefined ? (
          <EmptyState
            title="Choose a vault"
            detail="A vault is a folder of markdown files. Inkling reads and writes them in place, so anything already there shows up straight away."
            action={{label: 'Choose folder', onClick: handleChooseVault}}
          />
        ) : workspace.open === undefined ? (
          <EmptyState
            title="Nothing open"
            detail={
              workspace.docs.length === 0
                ? 'This vault has no markdown files yet.'
                : 'Pick something from the library to start writing.'
            }
          />
        ) : (
          <>
            {layout.previewOpen && (
              <>
                <div style={{width: layout.previewWidth}} className="shrink-0">
                  <PreviewPanel source={draft} />
                </div>
                <Splitter
                  width={layout.previewWidth}
                  onResize={resizePreview}
                  side="left"
                  label="Resize the preview"
                />
              </>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <EditorPanel
                  path={workspace.open.path}
                  source={draft}
                  onChange={editDraft}
                  onSelect={setSelection}
                  onSave={workspace.saveNow}
                  onFocus={handleEditorFocus}
                  findings={kept}
                  marksOn={layout.marksOn}
                  reveal={reveal}
                />
              </div>
              <FindingsStrip
                findings={kept}
                onPick={handlePick}
                suppressed={suppressed}
                onDismiss={dismiss}
                onRestore={handleRestore}
              />
            </div>
          </>
        )}

        {layout.chatOpen && (
          <>
            <Splitter
              width={layout.chatWidth}
              onResize={resizeChat}
              side="right"
              min={300}
              max={640}
              label="Resize the agent panel"
            />
            <div style={{width: layout.chatWidth}} className="shrink-0">
              {/* Mounted only once there is a conversation to hold the turns and
                  its stored history has been read: the panel takes its messages
                  at mount, and the key is what makes switching a remount rather
                  than one conversation's replies merging into another's. */}
              {transport !== undefined && conversations.loaded ? (
                <ChatPanel
                  key={conversationId}
                  transport={transport}
                  context={context}
                  references={referenceControls}
                  initial={conversations.initial}
                  conversations={conversationControls}
                  mode={mode}
                  onFlush={flush}
                  onAccept={handleAccept}
                  onLand={handleLand}
                  onPoint={handlePoint}
                  onFocus={handleChatFocus}
                />
              ) : (
                <section className="h-full border-l border-ink-800 bg-ink-950" />
              )}
            </div>
          </>
        )}
      </main>

      {/* The more fundamental problem first, in both lines. A save that failed
          outranks an agent turn that did, the way a database that will not open
          outranks a rule set that will not parse. An export that failed comes
          last of the three: nothing in the vault is at stake in it. */}
      <StatusBar
        error={workspace.error ?? agentError ?? outputError}
        notice={dataNotice(workspace.data) ?? voiceNotice(cascade.problems)}
        info={flash?.message}
      />
    </div>
  );
}

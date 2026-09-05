import {useCallback, useEffect, useMemo, useState} from 'react';
import {open} from '@tauri-apps/plugin-dialog';
import type {DocPath, VaultPath} from '@inkling/vault';
import {resolveVoice, type Finding} from '@inkling/voice';
import {isDesktop, loadSettings, saveSettings} from './lib/bridge.ts';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type LayoutSettings,
  type ToggleKey,
} from './lib/settings.ts';
import {stubTransport, type AgentContext} from './lib/agent.ts';
import {useFindings} from './lib/use-findings.ts';
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

/** No document open, so no rule set governs anything. Held still for the memos. */
const NO_CASCADE = Object.freeze({sets: [], problems: []});

/** Last path segment of the vault directory, which is what a writer named it. */
function vaultName(vault: VaultPath | undefined): string {
  if (vault === undefined) return 'No vault';
  return vault.split('/').filter(Boolean).pop() ?? vault;
}

export function App() {
  const workspace = useWorkspace();
  const [layout, setLayout] = useState<LayoutSettings>(DEFAULT_SETTINGS.layout);
  const [selection, setSelection] = useState('');
  const [pinned, setPinned] = useState<DocPath[]>([]);
  const [restored, setRestored] = useState(false);

  const {chooseVault, openDoc} = workspace;

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
      saveSettings({vault, lastDoc: openPath, layout}).catch(function (error) {
        console.warn('inkling: could not persist settings', error);
      });
    },
    [restored, vault, openPath, layout],
  );

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

  const unpin = useCallback(function (path: DocPath) {
    setPinned(function (current) {
      return current.filter(function (entry) {
        return entry !== path;
      });
    });
  }, []);

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

  // The vault scan already read every body, so pinning is a map lookup rather
  // than a file read. See the note on `list_docs` in `src-tauri/src/vault.rs`.
  const context: AgentContext = useMemo(
    function () {
      const draft = workspace.open?.draft;
      const path = workspace.open?.path;
      return {
        doc:
          path === undefined || draft === undefined
            ? undefined
            : {path, title: titles.get(path) ?? path, source: draft},
        selection: selection.length > 0 ? selection : undefined,
        pinned: pinned.flatMap(function (entry) {
          const source = workspace.sources.get(entry);
          if (source === undefined) return [];
          return [{path: entry, title: titles.get(entry) ?? entry, source}];
        }),
      };
    },
    [workspace.open?.draft, workspace.open?.path, workspace.sources, titles, pinned, selection],
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

  const {dismissals, dismiss, restore} = useSuppressions(openPath, workspace.data.kind === 'ready');
  const {kept, suppressed} = useFindings(draft, voice, dismissals);
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined);

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

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        title={title}
        subtitle={vaultName(vault)}
        save={workspace.open?.save}
        layout={layout}
        onToggle={handleToggle}
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
                  onChange={workspace.editDraft}
                  onSelect={setSelection}
                  onSave={workspace.saveNow}
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
              <ChatPanel transport={stubTransport} context={context} onUnpin={unpin} />
            </div>
          </>
        )}
      </main>

      {/* The database's own trouble first: a rule set that will not parse is
          the smaller problem when nothing inkling stores is available. */}
      <StatusBar
        error={workspace.error}
        notice={dataNotice(workspace.data) ?? voiceNotice(cascade.problems)}
      />
    </div>
  );
}

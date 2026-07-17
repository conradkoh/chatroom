'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getTeamEntryPoint } from '@workspace/backend/src/domain/entities/team';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Files,
  MessageSquare,
  MessageSquareOff,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  Square,
  XCircle,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AttachmentsProvider,
  dispatchComposerPrefill,
  dispatchComposerTextPrefill,
  PREFILL_TOAST_MESSAGE,
  SAVED_COMMAND_PREFILL_TOAST_MESSAGE,
} from './attachments';
import { ActivityBar, type ActivityView } from './components/ActivityBar';
import { AgentPanel } from './components/AgentPanel';
import { teamConfigToUpdateArgs } from './components/AgentPanel/TeamSelectorDropdown';
import { ChatroomTitleEditor } from './components/ChatroomTitleEditor';
import {
  CommandPalette,
  useCommandPaletteCommands,
  WorkspaceCommandsAggregator,
  type SettingsTab,
  type CommandItem,
} from './components/CommandPalette';
import { FileSelectorModal, FilePreviewDialog, useFileSelector } from './components/FileSelector';
import { isBinaryFile } from './components/FileSelector/binaryDetection';
import type { FileEntry } from './components/FileSelector/useFileSelector';
import { MessageInput } from './components/MessageInput';
import { PanelLoadingSpinner } from './components/PanelLoadingSpinner';
import { PromptModal } from './components/PromptModal';
import { SavedCommandModal } from './components/SavedCommandModal';
import { TerminalOutputPanel } from './components/TerminalOutputPanel';
import { ChatroomMessagesPanel } from './components/timeline/ChatroomMessagesPanel';
import { MessageViewToggle } from './components/timeline/MessageViewToggle';
import { WorkQueue } from './components/WorkQueue';
import { useCommandDialog } from './context/CommandDialogContext';
import { PendingFileHighlightProvider } from './context/PendingFileHighlightContext';
import { WorkspaceFileLinkProvider } from './context/WorkspaceFileLinkContext';
import { RightSplitPanel } from './explorer-split-panels/RightSplitPanel';
import { useAgentSidebarVisible } from './hooks/persistence/useAgentSidebarVisible';
import { useExplorerSidebarVisible } from './hooks/persistence/useExplorerSidebarVisible';
import { useExplorerSidebarWidth } from './hooks/persistence/useExplorerSidebarWidth';
import { useExplorerSplitPanelSizes } from './hooks/persistence/useExplorerSplitPanelSizes';
import { useMessageViewMode } from './hooks/persistence/useMessageViewMode';
import { isValidTwoPaneLayout } from './hooks/twoPaneLayout';
import { useTeamConfigs, type TeamConfigEntry } from './hooks/use-team-configs';
import { useAgentPanelData } from './hooks/useAgentPanelData';
import { useAgentStatuses } from './hooks/useAgentStatuses';
import { useChatroomLifecycle } from './hooks/useChatroomLifecycle';
import { useCommandRunner } from './hooks/useCommandRunner';
import { useCommandRunOutputV2 } from './hooks/useCommandRunOutputV2';
import { REFRESH_COOLDOWN_MS } from './hooks/useObserveChatroom';
import { useTimelineScroll } from './hooks/useTimelineScroll';
import { useTwoTapConfirm } from './hooks/useTwoTapConfirm';
import type { AgentConfig } from './types/machine';
import type { TeamLifecycle } from './types/readiness';
import type { SavedCommand, SavedCommandScope } from './types/savedCommand';
import {
  ensureAgentRolesConfigured,
  getFailedAgentRoles,
  runAgentStartBatch,
  startAgentsForRoles,
} from './utils/agentBulkStart';
import { AgenticQueryPanel } from './workspace/components/AgenticQueryPanel';
import { CsvTablePane } from './workspace/components/CsvTablePane';
import { ExplorerSidebarResizeHandle } from './workspace/components/ExplorerSidebarResizeHandle';
import { FileContentViewer } from './workspace/components/FileContentViewer';
import type { FileExplorerPanelHandle } from './workspace/components/FileExplorerPanel';
import { FileExplorerPanelLoadingShell } from './workspace/components/FileExplorerPanelLoadingShell';
import { FileTabBar } from './workspace/components/FileTabBar';
import { MarkdownFileEditorPane } from './workspace/components/MarkdownFileEditorPane';
import { MarkdownPreviewPane } from './workspace/components/MarkdownPreviewPane';
import { SourceControlPanel } from './workspace/components/panels/SourceControlPanel';
import { RightPaneTabBar } from './workspace/components/RightPaneTabBar';
import { WorkspaceBottomBar } from './workspace/components/WorkspaceBottomBar';
import { WorkspaceHeaderRow } from './workspace/components/WorkspaceTabBar';
import { isMarkdownFile } from './workspace/file-renderers';
import { useMultiWorkspaceFileSync } from './workspace/files';
import { useAgenticQueryTabOpener } from './workspace/hooks/useAgenticQueryTab';
import { useAgenticSearchShortcut } from './workspace/hooks/useAgenticSearchShortcut';
import { useExplorerTabCloseShortcut } from './workspace/hooks/useExplorerTabCloseShortcut';
import type { AgenticQueryMode, UseFileTabsReturn } from './workspace/hooks/useFileTabs';
import { editorTabKey } from './workspace/hooks/useFileTabs';
import { useOpenFileOnRemote } from './workspace/hooks/useOpenFileOnRemote';
import { useWorkspaceGit } from './workspace/hooks/useWorkspaceGit';
import {
  editorPaneFlexClass,
  isEditorExpanded,
  isPreviewExpanded,
  previewPaneFlexClass,
} from './workspace/utils/editorExpandLayout';
import { previewTabDoubleClickAction } from './workspace/utils/explorerExpandHandlers';
import type { FileLocation } from './workspace/utils/fileLocation';
import { pendingHighlightForLocation } from './workspace/utils/openFileLocation';
import { resolveWorkspaceFileLinkOpenTarget } from './workspace/utils/workspaceFileLink';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { PromptsProvider } from '@/contexts/PromptsContext';
import { useDaemonConnected } from '@/hooks/useDaemonConnected';
import { useSendLocalAction } from '@/hooks/useSendLocalAction';
import { getAppTitle } from '@/lib/environment';
import { exhaustive } from '@/lib/exhaustive';
import { toRepoHttpsUrl } from '@/lib/git-url';
import { openExternalUrl } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useSetHeaderPortal } from '@/modules/header/HeaderPortalProvider';

const AgentSettingsModal = dynamic(
  () => import('./components/AgentSettingsModal').then((m) => ({ default: m.AgentSettingsModal })),
  { loading: () => null }
);

const SetupChecklistModal = dynamic(
  () =>
    import('./components/SetupChecklistModal').then((m) => ({ default: m.SetupChecklistModal })),
  { loading: () => null }
);

const FileExplorerPanel = dynamic(
  () =>
    import('./workspace/components/FileExplorerPanel').then((m) => ({
      default: m.FileExplorerPanel,
    })),
  { loading: () => <FileExplorerPanelLoadingShell /> }
);

const DirectHarnessView = dynamic(
  () =>
    import('./direct-harness/components/DirectHarnessView').then((m) => ({
      default: m.DirectHarnessView,
    })),
  { loading: () => <PanelLoadingSpinner /> }
);

const PullRequestsPanel = dynamic(
  () =>
    import('./workspace/components/panels/PullRequestsPanel').then((m) => ({
      default: m.PullRequestsPanel,
    })),
  { loading: () => <PanelLoadingSpinner /> }
);

const ProcessesPanel = dynamic(
  () =>
    import('./workspace/components/panels/ProcessesPanel').then((m) => ({
      default: m.ProcessesPanel,
    })),
  { loading: () => <PanelLoadingSpinner /> }
);

// Constant to indicate "all machines" when stopping agents across all connected machines
const ALL_MACHINES = '';

// ─── Teams Config ────────────────────────────────────────────────────────────
// NOTE: For chatroom-themed floating popups/dropdowns, use `modules/chatroom/components/ui/dropdown-menu`.
// For modals and delete confirmations, use `modules/chatroom/components/ui/dialog` and `alert-dialog`.
// Shared tokens: `modules/chatroom/components/shared/industrialDialogStyles.ts`.
// Do NOT use `bg-chatroom-bg-surface` (glassmorphism/semi-transparent) on portaled menus.

interface ChatroomDashboardProps {
  chatroomId: string;
  onBack?: () => void;
  /** From the chatroom page (`useObserveChatroom`); forwarded to the git panel for on-demand observed-sync refresh. */
  refreshObservedChatroom: () => void;
  listingSidebarVisible?: boolean;
  onToggleListingSidebar?: () => void;
}

/** Edit target for the saved command modal */
type SavedCommandEditTarget = SavedCommand;

interface ChatroomHeaderLeftProps {
  listingSidebarVisible: boolean;
  onToggleListingSidebar?: () => void;
}

function ChatroomHeaderLeft({
  listingSidebarVisible,
  onToggleListingSidebar,
}: ChatroomHeaderLeftProps) {
  if (!onToggleListingSidebar) return null;

  return (
    <button
      type="button"
      className="hidden lg:flex bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
      onClick={onToggleListingSidebar}
      title={listingSidebarVisible ? 'Hide chatrooms sidebar' : 'Show chatrooms sidebar'}
      aria-label={listingSidebarVisible ? 'Hide chatrooms sidebar' : 'Show chatrooms sidebar'}
    >
      {listingSidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
    </button>
  );
}

interface ChatroomHeaderCenterProps {
  onBack?: () => void;
  onOpenSettings: () => void;
  displayName: string;
  chatroomId: string;
}

function ChatroomHeaderCenter({
  onBack,
  onOpenSettings,
  displayName,
  chatroomId,
}: ChatroomHeaderCenterProps) {
  return (
    <ChatroomTitleEditor
      displayName={displayName}
      chatroomId={chatroomId}
      onBack={onBack}
      onOpenSettings={onOpenSettings}
    />
  );
}

// ─── Explorer Content Component ───────────────────────────────────────────────
// Extracts shared file explorer UI to eliminate duplication between split/non-split views

interface ExplorerContentProps {
  fileTabs: UseFileTabsReturn;
  activeWorkspace: {
    workspaceId: string | null;
    machineId: string | null;
    workingDir: string | null;
  } | null;
  autocompleteFiles: FileEntry[];
  hasAutocompleteWorkspace: boolean;
  onAtTriggerActivate: () => void;
  onOpenPreview: (filePath: string) => void;
  onOpenTableView: (filePath: string) => void;
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
  agenticFocusToken: number;
}

// fallow-ignore-next-line complexity
const ExplorerContent = memo(function ExplorerContent({
  fileTabs,
  activeWorkspace,
  autocompleteFiles,
  hasAutocompleteWorkspace,
  onAtTriggerActivate,
  onOpenPreview,
  onOpenTableView,
  onSendSelectionToComposer,
  agenticFocusToken,
}: ExplorerContentProps) {
  const machineId = activeWorkspace?.machineId ?? '';
  const workingDir = activeWorkspace?.workingDir ?? '';
  const { openFileOnRemote } = useOpenFileOnRemote(machineId, workingDir);

  const activeTab = fileTabs.tabs.find((t) => editorTabKey(t) === fileTabs.activeTabKey) ?? null;
  const activeFilePath = activeTab?.kind === 'file' ? activeTab.filePath : fileTabs.activeTabKey;
  const showTabBar = fileTabs.tabs.length > 0;

  const handleOpenSelectionOnRemote = useCallback(
    (filePath: string, selectedText: string) => {
      void openFileOnRemote(filePath, selectedText);
    },
    [openFileOnRemote]
  );

  const hasSplit = fileTabs.rightTabs.length > 0;
  const editorExpanded = isEditorExpanded(
    hasSplit,
    fileTabs.expandedTabPath,
    fileTabs.expandedPane,
    activeFilePath
  );
  const previewExpanded = isPreviewExpanded(
    hasSplit,
    fileTabs.expandedTabPath,
    fileTabs.expandedPane,
    activeFilePath
  );

  const handleTogglePreviewExpanded = useCallback(() => {
    if (activeFilePath) {
      fileTabs.togglePreviewExpanded(activeFilePath);
    }
  }, [activeFilePath, fileTabs]);

  const activeAgenticQueryId = activeTab?.kind === 'agentic-query' ? activeTab.queryId : null;

  const handleAgenticMetaChange = useCallback(
    ({ title, mode }: { title: string; mode: AgenticQueryMode }) => {
      if (!activeAgenticQueryId) return;
      fileTabs.openAgenticQueryTab(activeAgenticQueryId, mode, title);
    },
    [activeAgenticQueryId, fileTabs]
  );

  const fileTabBar = showTabBar ? (
    <FileTabBar
      tabs={fileTabs.tabs}
      activeTabKey={fileTabs.activeTabKey}
      machineId={activeWorkspace?.machineId ?? null}
      workingDir={activeWorkspace?.workingDir ?? null}
      onActivate={fileTabs.setActiveTab}
      onClose={fileTabs.closeTab}
      onCloseOthers={fileTabs.closeOtherTabs}
      onPin={fileTabs.pinTab}
      onToggleExpanded={fileTabs.toggleExpanded}
      onOpenFileOnRemote={(filePath) => void openFileOnRemote(filePath)}
    />
  ) : null;
  const hasMachineAndDir = activeWorkspace?.machineId && activeWorkspace?.workingDir;
  const showContentArea = activeTab && hasMachineAndDir;

  return (
    <>
      {/* Full-width tab bar when no preview/table split */}
      {showTabBar && !hasSplit && fileTabBar}

      {/* Content Area — left pane + optional right pane */}
      {showContentArea ? (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Pane — source code */}
          <div
            className={cn(
              'flex flex-col min-h-0 overflow-hidden',
              hasSplit
                ? cn(
                    editorPaneFlexClass(editorExpanded, previewExpanded, hasSplit),
                    'border-r border-chatroom-border'
                  )
                : 'flex-1'
            )}
          >
            {showTabBar && hasSplit && fileTabBar}
            {activeTab.kind === 'agentic-query' ? (
              <AgenticQueryPanel
                key={editorTabKey(activeTab)}
                queryId={activeTab.queryId}
                mode={activeTab.mode}
                workspaceId={activeWorkspace?.workspaceId ?? ''}
                autocompleteFiles={autocompleteFiles}
                hasAutocompleteWorkspace={hasAutocompleteWorkspace}
                onAtTriggerActivate={onAtTriggerActivate}
                focusToken={agenticFocusToken}
                onMetaChange={handleAgenticMetaChange}
              />
            ) : activeTab.kind === 'file' ? (
              isBinaryFile(activeTab.filePath) ? (
                <FileContentViewer
                  key={activeTab.filePath}
                  machineId={machineId}
                  workingDir={workingDir}
                  filePath={activeTab.filePath}
                  onSendSelectionToComposer={onSendSelectionToComposer}
                  onOpenPreview={onOpenPreview}
                  onOpenTableView={onOpenTableView}
                  onOpenSelectionOnRemote={handleOpenSelectionOnRemote}
                />
              ) : (
                <MarkdownFileEditorPane
                  key={activeTab.filePath}
                  machineId={machineId}
                  workingDir={workingDir}
                  filePath={activeTab.filePath}
                  onSendSelectionToComposer={onSendSelectionToComposer}
                  onOpenPreview={onOpenPreview}
                  onOpenSelectionOnRemote={handleOpenSelectionOnRemote}
                />
              )
            ) : null}
          </div>

          {/* Right Pane — preview/table */}
          {hasSplit && (
            <div
              className={cn(
                'flex flex-col min-h-0 overflow-hidden',
                previewPaneFlexClass(editorExpanded, previewExpanded)
              )}
            >
              <RightPaneTabBar
                tabs={fileTabs.rightTabs}
                activeTabKey={fileTabs.activeRightTabKey}
                onActivate={fileTabs.setActiveRightTab}
                onClose={fileTabs.closeRight}
                onTabDoubleClick={(tab) => {
                  const action = previewTabDoubleClickAction(tab.viewType, activeFilePath);
                  if (action?.action === 'togglePreviewExpanded') {
                    fileTabs.togglePreviewExpanded(action.filePath);
                  }
                }}
              />
              {(() => {
                const activeRight = fileTabs.rightTabs.find(
                  (t) => t.key === fileTabs.activeRightTabKey
                );
                if (!activeRight) return null;
                const mw = activeWorkspace?.machineId;
                const wd = activeWorkspace?.workingDir;
                if (!mw || !wd) return null;
                if (activeRight.viewType === 'preview') {
                  return (
                    <MarkdownPreviewPane
                      key={activeRight.key}
                      machineId={mw}
                      workingDir={wd}
                      filePath={activeRight.filePath}
                      onDoubleClick={handleTogglePreviewExpanded}
                    />
                  );
                }
                if (activeRight.viewType === 'table') {
                  return (
                    <CsvTablePane
                      key={activeRight.key}
                      machineId={mw}
                      workingDir={wd}
                      filePath={activeRight.filePath}
                    />
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      ) : (
        /* Empty state — no files open in explorer view */
        <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
          <div className="text-center">
            <Files size={32} className="mx-auto mb-2 opacity-40" />
            <p>No files open</p>
            <p className="text-xs mt-1">
              Select a file from the explorer to view it, or press Cmd+Shift+F to search
            </p>
          </div>
        </div>
      )}
    </>
  );
});

interface ModalState {
  isOpen: boolean;
  role: string;
}

interface Chatroom {
  _id: string;
  status: string;
  name?: string;
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
}

// Hook to check if screen is small (< 768px)
// Returns undefined during SSR/hydration to prevent layout flickering
function useIsSmallScreen(): boolean | undefined {
  const [mounted, setMounted] = useState(false);
  const [isSmall, setIsSmall] = useState(false);

  useEffect(() => {
    // Mark as mounted and check initial screen size
    setMounted(true);
    const checkSize = () => setIsSmall(window.innerWidth < 768);
    checkSize();

    // Listen for resize events
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  // Return undefined during SSR/hydration to trigger loading state
  return mounted ? isSmall : undefined;
}

export function ChatroomDashboard({
  chatroomId,
  onBack,
  refreshObservedChatroom,
  listingSidebarVisible = true,
  onToggleListingSidebar,
}: ChatroomDashboardProps) {
  const { teams, defaultTeamId } = useTeamConfigs();
  const router = useRouter();

  // ─── Scroll controller (shared between timeline feed and SendForm) ───
  const { coordinator: timelineScrollCoordinator, beginResize, endResize } = useTimelineScroll();

  // ─── Centralised per-chatroom lifecycle (persistence + ephemeral state) ───
  const chatroomLifecycle = useChatroomLifecycle(chatroomId as Id<'chatroom_rooms'>);
  const {
    fileTabs,
    activityView: activeView,
    setActivityView,
    activeWorkspace,
    workspaces: chatroomWorkspaces,
    splitMode,
    setSplitMode,
    selectedHarnessSessionId,
    setSelectedHarnessSessionId,
    explorerSplitViewEnabled,
    setExplorerSplitViewEnabled,
    explorerSyncEnabled,
    setExplorerSyncEnabled,
  } = chatroomLifecycle;

  const [messageViewMode, setMessageViewMode] = useMessageViewMode(chatroomId);

  const [explorerSplitSizes, setExplorerSplitSizes] = useExplorerSplitPanelSizes(
    chatroomId as Id<'chatroom_rooms'>
  );
  const handleExplorerSplitLayoutChanged = useCallback(
    (layout: { [id: string]: number }) => {
      const next: [number, number] = [
        layout['explorer-split-left'] ?? explorerSplitSizes[0],
        layout['explorer-split-right'] ?? explorerSplitSizes[1],
      ];
      if (isValidTwoPaneLayout(next)) setExplorerSplitSizes(next);
    },
    [explorerSplitSizes, setExplorerSplitSizes]
  );

  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    role: '',
  });

  // Agent settings modal state
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);

  // Terminal output panel state
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Processes panel state — pre-selected command for deep-linking from palette
  const [processesInitialCommand, setProcessesInitialCommand] = useState<string | null>(null);

  // Setup checklist modal state - starts open
  const [setupModalOpen, setSetupModalOpen] = useState(true);

  // Saved Command modal state
  const [savedCommandModalOpen, setSavedCommandModalOpen] = useState(false);
  const [savedCommandEditTarget, setSavedCommandEditTarget] = useState<
    SavedCommandEditTarget | undefined
  >(undefined);
  const [savedCommandCreateScope, setSavedCommandCreateScope] =
    useState<SavedCommandScope>('chatroom');

  const handleOpenSavedCommandModal = useCallback(
    (target?: SavedCommandEditTarget, defaultScope: SavedCommandScope = 'chatroom') => {
      setSavedCommandEditTarget(target);
      setSavedCommandCreateScope(defaultScope);
      setSavedCommandModalOpen(true);
    },
    []
  );
  const handleCloseSavedCommandModal = useCallback(() => {
    setSavedCommandModalOpen(false);
    setSavedCommandEditTarget(undefined);
  }, []);

  const handleEditSavedCommand = useCallback(
    (cmd: SavedCommand) => handleOpenSavedCommandModal(cmd),
    [handleOpenSavedCommandModal]
  );

  // Sidebar visibility state - persisted per chatroom; forced hidden on small screens
  const isSmallScreen = useIsSmallScreen();
  const [sidebarVisible, setSidebarVisible] = useAgentSidebarVisible(
    chatroomId as Id<'chatroom_rooms'>
  );

  // Explorer sidebar sub-state: visible (sidebar+preview) or hidden (preview-only)
  const [explorerSidebarVisible, setExplorerSidebarVisible] = useExplorerSidebarVisible(
    chatroomId as Id<'chatroom_rooms'>
  );
  const [explorerSidebarWidth, setExplorerSidebarWidth] = useExplorerSidebarWidth(
    chatroomId as Id<'chatroom_rooms'>
  );
  const fileExplorerPanelRef = useRef<FileExplorerPanelHandle>(null);

  const [agenticFocusToken, setAgenticFocusToken] = useState(0);
  const requestAgenticFocus = useCallback(() => setAgenticFocusToken((n) => n + 1), []);

  const ensureExplorerForAgentic = useCallback(() => {
    setActivityView('explorer');
    setExplorerSidebarVisible(true);
    fileExplorerPanelRef.current?.refresh();
  }, []);

  const { openTab } = useAgenticQueryTabOpener(
    activeWorkspace?.workspaceId ?? undefined,
    fileTabs,
    { onFocusRequest: requestAgenticFocus, onBeforeOpen: ensureExplorerForAgentic }
  );

  const handleOpenAgenticQuery = useCallback(() => {
    void openTab();
  }, [openTab]);

  useAgenticSearchShortcut({ onOpen: handleOpenAgenticQuery });
  useExplorerTabCloseShortcut({
    enabled: activeView === 'explorer',
    activeTabKey: fileTabs.activeTabKey,
    onCloseTab: fileTabs.closeTab,
  });

  // Handle ActivityBar view changes with toggle sub-state support
  const focusSendFormRef = useRef<(() => void) | null>(null);

  const handleRegisterSendFormFocus = useCallback((fn: () => void) => {
    focusSendFormRef.current = fn;
  }, []);

  const handleExplorerSelectionToComposer = useCallback(
    ({ filePath, selectedText }: { filePath: string; selectedText: string }) => {
      if (!explorerSplitViewEnabled) {
        setExplorerSplitViewEnabled(true);
      }

      setSplitMode('messages');

      dispatchComposerPrefill({
        target: 'messages',
        fileSource: filePath,
        selectedContent: selectedText,
      });
      toast.message(PREFILL_TOAST_MESSAGE);
    },
    [explorerSplitViewEnabled, setExplorerSplitViewEnabled, setSplitMode]
  );

  const handleActivityViewChange = useCallback(
    (view: ActivityView) => {
      if (view === activeView) {
        // Already on this view — toggle sub-state
        if (view === 'explorer') {
          setExplorerSidebarVisible(!explorerSidebarVisible);
        }
      } else {
        // Switch to different view
        setActivityView(view);
        // Focus message input when switching to messages
        if (view === 'messages') {
          setTimeout(() => focusSendFormRef.current?.(), 0);
        }
      }
    },
    [activeView, explorerSidebarVisible, setExplorerSidebarVisible, setActivityView]
  );

  // File select handler: single click = preview, double click = pin
  const handleFileSelect = useCallback(
    (filePath: string) => {
      fileTabs.openPreview(filePath);
    },
    [fileTabs.openPreview]
  );

  const handleFileDoubleClick = useCallback(
    (filePath: string) => {
      fileTabs.pinTab(filePath);
      if (isMarkdownFile(filePath)) {
        fileTabs.openRight(filePath, 'preview');
      }
    },
    [fileTabs.pinTab, fileTabs.openRight]
  );

  // Track the path to reveal in the file tree
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [pendingFileHighlight, setPendingFileHighlight] = useState<FileLocation | null>(null);

  // Right pane handlers
  const handleOpenPreview = useCallback(
    (filePath: string) => {
      fileTabs.openRight(filePath, 'preview');
    },
    [fileTabs.openRight]
  );

  const handleOpenTableView = useCallback(
    (filePath: string) => {
      fileTabs.openRight(filePath, 'table');
    },
    [fileTabs.openRight]
  );

  // Force-hide sidebars on small screens; preserve stored desktop preference when expanding
  useEffect(() => {
    if (isSmallScreen) {
      setSidebarVisible(false);
      setExplorerSidebarVisible(false);
    }
  }, [isSmallScreen, setSidebarVisible, setExplorerSidebarVisible]);

  // Lock body scroll when sidebar overlay is visible on mobile
  useEffect(() => {
    if (sidebarVisible && isSmallScreen) {
      // Store original styles
      const originalOverflow = document.body.style.overflow;
      const originalPosition = document.body.style.position;
      const originalTop = document.body.style.top;
      const originalWidth = document.body.style.width;
      const scrollY = window.scrollY;

      // Lock body scroll
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';

      return () => {
        // Restore original styles
        document.body.style.overflow = originalOverflow;
        document.body.style.position = originalPosition;
        document.body.style.top = originalTop;
        document.body.style.width = originalWidth;
        // Restore scroll position
        window.scrollTo(0, scrollY);
      };
    }
  }, [sidebarVisible, isSmallScreen]);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible(!sidebarVisible);
  }, [sidebarVisible, setSidebarVisible]);

  // Header portal integration
  const { setContent: setHeaderContent, clearContent: clearHeaderContent } = useSetHeaderPortal();

  const chatroom = useSessionQuery(api.chatrooms.get, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Chatroom | null | undefined;

  // Saved commands query
  const savedCommandsData = useSessionQuery(api.savedCommands.listSavedCommands, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  // Send message mutation (used to execute saved commands)
  const deleteSavedCommandMutation = useSessionMutation(api.savedCommands.deleteSavedCommand);
  const recordObservationMutation = useSessionMutation(api.chatrooms.recordChatroomObservation);
  const requestGitRefreshMutation = useSessionMutation(api.machines.requestGitRefresh);
  const lastRefreshRef = useRef(0);

  const handleConfirmedDelete = useCallback(
    async (commandId: string) => {
      try {
        await deleteSavedCommandMutation({
          commandId: commandId as Id<'chatroom_savedCommands'>,
        });
      } catch (error) {
        console.error('Failed to delete saved command:', error);
        toast.error('Failed to delete command. Please try again.');
      }
    },
    [deleteSavedCommandMutation]
  );

  const { armedKey: confirmingDeleteCommandId, request: deleteRequest } = useTwoTapConfirm<string>(
    handleConfirmedDelete,
    3000
  );

  const handleDeleteSavedCommand = useCallback(
    (commandId: string, _name: string) => deleteRequest(commandId),
    [deleteRequest]
  );

  const handleExecuteSavedCommand = useCallback(
    (cmd: SavedCommand) => {
      switch (cmd.type) {
        case 'prompt':
          setActivityView('messages');
          dispatchComposerTextPrefill(cmd.prompt);
          toast.message(SAVED_COMMAND_PREFILL_TOAST_MESSAGE);
          setTimeout(() => focusSendFormRef.current?.(), 0);
          break;
        default:
          exhaustive(cmd.type);
      }
    },
    [setActivityView]
  );

  const savedCommands: SavedCommand[] = useMemo(
    () =>
      (savedCommandsData ?? []).map((cmd) => ({
        _id: cmd._id,
        type: cmd.type,
        scope: cmd.scope,
        name: cmd.name,
        prompt: cmd.prompt,
      })),
    [savedCommandsData]
  );

  const existingNamesByScope = useMemo(
    () => ({
      chatroom: savedCommands.filter((c) => c.scope === 'chatroom').map((c) => c.name),
      user: savedCommands.filter((c) => c.scope === 'user').map((c) => c.name),
    }),
    [savedCommands]
  );

  // Update team mutation (for switching teams)
  const updateTeam = useSessionMutation(api.chatrooms.updateTeam);

  const handleTeamChange = useCallback(
    async (team: TeamConfigEntry) => {
      await updateTeam(teamConfigToUpdateArgs(chatroomId, team));
    },
    [updateTeam, chatroomId]
  );

  // Mark chatroom as read mutation (for unread indicators)
  const markAsRead = useSessionMutation(api.chatrooms.markAsRead);

  // Mark chatroom as read when it loads (and periodically while viewing)
  useEffect(() => {
    if (!chatroom) return;

    const mark = () => {
      if (document.hidden) return;
      markAsRead({ chatroomId: chatroomId as Id<'chatroom_rooms'> }).catch(() => {
        // Silently ignore - non-critical
      });
    };

    mark();

    // Refresh cursor periodically while the tab is focused (60s — backend skips if fresh)
    const interval = setInterval(mark, 60_000);

    const onVisibilityChange = () => {
      if (!document.hidden) mark();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [chatroom, chatroomId, markAsRead]);

  const lifecycle = useSessionQuery(api.participants.getTeamLifecycle, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamLifecycle | null | undefined;

  // Agent panel data (for Start All Remote Agents command)
  const agentPanelData = useAgentPanelData(chatroomId);

  // Per-role "last used" config derived from the persisted teamAgentConfigs
  // (the single source of truth, replacing the removed agentPreference store).
  // Keyed by lowercased role; when a role has multiple configs (across machines),
  // the most-recently-updated one wins.
  const roleConfigMap = useMemo(() => {
    const map = new Map<string, AgentConfig>();
    for (const config of agentPanelData.machineConfigs) {
      const key = config.role.toLowerCase();
      const existing = map.get(key);
      if (!existing || config.updatedAt > existing.updatedAt) {
        map.set(key, config);
      }
    }
    return map;
  }, [agentPanelData.machineConfigs]);

  // Machine name map for event stream display
  const machineNameMap = useMemo(() => {
    const map = new Map<string, { hostname: string; alias?: string }>();
    for (const machine of agentPanelData.connectedMachines) {
      map.set(machine.machineId, { hostname: machine.hostname, alias: machine.alias });
    }
    return map;
  }, [agentPanelData.connectedMachines]);

  // Memoize derived values
  const teamRoles = useMemo(() => chatroom?.teamRoles || [], [chatroom?.teamRoles]);
  const teamName = useMemo(() => chatroom?.teamName || 'Team', [chatroom?.teamName]);

  // Derive participants list from lifecycle data
  const participants = useMemo(() => lifecycle?.participants ?? [], [lifecycle?.participants]);

  // Check if all team members have joined (memoized)
  const allMembersJoined = useMemo(
    () =>
      teamRoles.every((role) =>
        participants.some(
          (p) => p.role.toLowerCase() === role.toLowerCase() && p.lastSeenAt != null
        )
      ),
    [teamRoles, participants]
  );

  // Use hook to get aggregate status (event stream + lifecycle)
  const { aggregateStatus } = useAgentStatuses(chatroomId, teamRoles);

  // File selector (Cmd+P)
  const fileSelector = useFileSelector({
    chatroomId,
    machineId: activeWorkspace?.machineId ?? null,
    workingDir: activeWorkspace?.workingDir ?? null,
  });

  // Multi-workspace file tree: producer sync + store-backed autocomplete
  const { files: autocompleteFiles, refreshAll: refreshAutocompleteFiles } =
    useMultiWorkspaceFileSync(chatroomWorkspaces);
  const handleAtTriggerActivate = useCallback(() => {
    refreshAutocompleteFiles();
  }, [refreshAutocompleteFiles]);
  const hasAutocompleteWorkspace = chatroomWorkspaces.some(
    (workspace) => workspace.machineId && workspace.workingDir
  );

  const handleFilePreviewClose = useCallback(() => {
    fileSelector.selectFile('');
  }, [fileSelector]);

  const openFileLocationInExplorer = useCallback(
    (location: FileLocation) => {
      setPendingFileHighlight(pendingHighlightForLocation(location));
      fileTabs.pinTab(location.filePath);
      setActivityView('explorer');
      setExplorerSidebarVisible(true);
      setRevealPath(location.filePath);
    },
    [fileTabs.pinTab, setActivityView, setExplorerSidebarVisible]
  );

  const handleOpenInExplorer = useCallback(
    (filePath: string) => {
      openFileLocationInExplorer({ filePath });
    },
    [openFileLocationInExplorer]
  );

  const { openFileOnRemote: doOpenFileOnRemote } = useOpenFileOnRemote(
    activeWorkspace?.machineId ?? '',
    activeWorkspace?.workingDir ?? ''
  );

  const handleOpenFileOnRemote = useCallback(
    (filePath: string) => {
      void doOpenFileOnRemote(filePath);
    },
    [doOpenFileOnRemote]
  );

  // Handler for Cmd+P file selection — opens as pinned tab and reveals in tree
  const handleCmdPFileSelect = useCallback(
    (filePath: string) => {
      if (!filePath) return;
      // Close the file picker modal
      fileSelector.setOpen(false);
      // If already in explorer view, open inline instead of preview modal
      if (activeView === 'explorer') {
        handleOpenInExplorer(filePath);
      } else {
        // Track in recent files and open preview dialog
        fileSelector.selectFile(filePath);
      }
    },
    [fileSelector, activeView, handleOpenInExplorer]
  );

  const handleWorkspaceFileLinkClick = useCallback(
    (location: FileLocation) => {
      if (!location.filePath) return;
      const target = resolveWorkspaceFileLinkOpenTarget(activeView, explorerSplitViewEnabled);
      if (target === 'explorer') {
        openFileLocationInExplorer(location);
      } else {
        setPendingFileHighlight(pendingHighlightForLocation(location));
        fileSelector.selectFile(location.filePath);
      }
    },
    [activeView, explorerSplitViewEnabled, openFileLocationInExplorer, fileSelector]
  );

  // Command runner (for Cmd+Shift+P "Run Script" commands)
  const commandRunner = useCommandRunner({
    machineId: activeWorkspace?.machineId ?? null,
    workingDir: activeWorkspace?.workingDir ?? null,
  });

  // Single demand-driven output subscription for processes panel, terminal, and palette.
  const { activeRunOutput, palette: inlineCommand } = useCommandRunOutputV2(commandRunner, {
    panelOutputVisible: activeView === 'processes' || terminalOpen,
  });

  // ─── Command Palette (Cmd+Shift+P) ────────────────────────────────────────
  // Refs to hold imperative open callbacks registered by child components
  const openEventStreamRef = useRef<(() => void) | null>(null);
  const openBacklogRef = useRef<(() => void) | null>(null);
  const openBacklogCreateRef = useRef<(() => void) | null>(null);
  const openPendingReviewRef = useRef<(() => void) | null>(null);
  const removeMessagesForTaskRef = useRef<((taskId: string) => void) | null>(null);

  const handleRegisterOpenEventStream = useCallback((fn: () => void) => {
    openEventStreamRef.current = fn;
  }, []);

  const handleRegisterMessageStoreActions = useCallback(
    (actions: { removeMessagesForTask: (taskId: string) => void }) => {
      removeMessagesForTaskRef.current = actions.removeMessagesForTask;
    },
    []
  );

  const handleTaskDeleted = useCallback((taskId: string) => {
    removeMessagesForTaskRef.current?.(taskId);
  }, []);

  const handleRegisterWorkQueueActions = useCallback(
    (actions: {
      openBacklog: () => void;
      openPendingReview: () => void;
      openBacklogCreate: () => void;
    }) => {
      openBacklogRef.current = actions.openBacklog;
      openBacklogCreateRef.current = actions.openBacklogCreate;
      openPendingReviewRef.current = actions.openPendingReview;
    },
    []
  );

  // Command palette open handlers — delegate to child refs
  const handleCmdOpenSettings = useCallback((tab: SettingsTab) => {
    setSettingsInitialTab(tab);
    setSettingsModalOpen(true);
  }, []);

  // Switch to Source Control activity view
  const handleSwitchToSourceControl = useCallback(() => {
    setActivityView('source-control');
  }, [setActivityView]);

  // Switch to Pull Requests activity view
  const handleSwitchToPullRequests = useCallback(() => {
    setActivityView('pull-requests');
  }, [setActivityView]);

  const handleCmdOpenEventStream = useCallback(() => {
    openEventStreamRef.current?.();
  }, []);

  const handleCmdOpenBacklog = useCallback(() => {
    openBacklogRef.current?.();
  }, []);

  const handleCmdCreateBacklogItem = useCallback(() => {
    openBacklogCreateRef.current?.();
  }, []);

  const handleCmdOpenPendingReview = useCallback(() => {
    openPendingReviewRef.current?.();
  }, []);

  // ─── Workspace context for command palette actions ─────────────────────────
  const { isConnected: isLocalWorkspace } = useDaemonConnected(activeWorkspace?.machineId ?? null);
  const sendAction = useSendLocalAction();
  const gitState = useWorkspaceGit(
    activeWorkspace?.machineId ?? '',
    activeWorkspace?.workingDir ?? ''
  );

  // Derive PR URL from git state
  const prUrl = useMemo(() => {
    if (gitState.status !== 'available') return null;
    const pr = gitState.openPullRequests?.[0];
    return pr?.url ?? null;
  }, [gitState]);

  // Derive GitHub repo URL from git remotes
  const gitHubRepoUrl = useMemo(() => {
    if (gitState.status !== 'available') return null;
    const origin = gitState.remotes.find((r) => r.name === 'origin');
    if (!origin) return null;
    return toRepoHttpsUrl(origin.url);
  }, [gitState]);

  // Action command callbacks — stable, conditionally nulled
  const handleOpenInVSCode = useCallback(() => {
    if (activeWorkspace?.machineId && activeWorkspace?.workingDir) {
      sendAction(activeWorkspace.machineId, 'open-vscode', activeWorkspace.workingDir);
    }
  }, [activeWorkspace?.machineId, activeWorkspace?.workingDir, sendAction]);

  const handleOpenInGitHubDesktop = useCallback(() => {
    if (activeWorkspace?.machineId && activeWorkspace?.workingDir) {
      sendAction(activeWorkspace.machineId, 'open-github-desktop', activeWorkspace.workingDir);
    }
  }, [activeWorkspace?.machineId, activeWorkspace?.workingDir, sendAction]);

  const handleOpenPROnGitHub = useCallback(() => {
    if (prUrl) openExternalUrl(prUrl);
  }, [prUrl]);

  const handleViewGitHubPullRequests = useCallback(() => {
    if (gitHubRepoUrl) openExternalUrl(`${gitHubRepoUrl}/pulls/@me`);
  }, [gitHubRepoUrl]);

  const handleViewGitHubRepository = useCallback(() => {
    if (gitHubRepoUrl) openExternalUrl(gitHubRepoUrl);
  }, [gitHubRepoUrl]);

  // ─── Multi-workspace command palette commands ──────────────────────────────
  const [workspaceCommands, setWorkspaceCommands] = useState<CommandItem[]>([]);
  const workspaceCommandCallbacks = useMemo(
    () => ({
      sendAction,
      openExternalUrl,
      onOpenGitPanel: handleSwitchToSourceControl,
    }),
    [sendAction, handleSwitchToSourceControl]
  );

  // Start all remote agents handler
  const [isStartingAllAgents, setIsStartingAllAgents] = useState(false);
  const getConfiguredAgentRoles = useCallback((): string[] | null => {
    const agentRoles = teamRoles.filter((r) => r !== 'user');
    if (
      !ensureAgentRolesConfigured(agentRoles, roleConfigMap, () => handleCmdOpenSettings('agents'))
    ) {
      return null;
    }
    return agentRoles;
  }, [teamRoles, roleConfigMap, handleCmdOpenSettings]);

  const handleStartAllRemoteAgents = useCallback(async () => {
    const agentRoles = getConfiguredAgentRoles();
    if (!agentRoles) return;
    // Start all agents in parallel using their persisted configs
    setIsStartingAllAgents(true);
    const chatroomIdTyped = chatroomId as Id<'chatroom_rooms'>;
    const results = await startAgentsForRoles(
      agentRoles,
      roleConfigMap,
      chatroomIdTyped,
      agentPanelData.sendCommand
    );
    setIsStartingAllAgents(false);

    const failed = getFailedAgentRoles(results, agentRoles);
    if (failed.length > 0) {
      toast.error(`Failed to start: ${failed.join(', ')}`);
    }
  }, [agentPanelData, roleConfigMap, chatroomId, getConfiguredAgentRoles]);

  // Stop all remote agents confirmation dialog state
  const [stopAllConfirmOpen, setStopAllConfirmOpen] = useState(false);

  // Stop all remote agents handler - shows confirmation dialog first
  const handleStopAllRemoteAgents = useCallback(() => {
    setStopAllConfirmOpen(true);
  }, []);

  // Actual stop action after confirmation
  const [isStoppingAllAgents, setIsStoppingAllAgents] = useState(false);
  const executeStopAllRemoteAgents = useCallback(async () => {
    setStopAllConfirmOpen(false);
    setIsStoppingAllAgents(true);
    const chatroomIdTyped = chatroomId as Id<'chatroom_rooms'>;
    const stoppableAgents = agentPanelData.agents.filter(
      (a) => (a.state === 'running' || a.state === 'starting') && a.machineId
    );

    if (stoppableAgents.length === 0) {
      setIsStoppingAllAgents(false);
      toast.success('No running agents to stop');
      return;
    }

    const results = await Promise.allSettled(
      stoppableAgents.map((agent) => {
        const mid = agent.machineId;
        if (!mid) return null;
        return agentPanelData.sendCommand({
          machineId: mid,
          type: 'stop-agent' as const,
          payload: {
            chatroomId: chatroomIdTyped,
            role: agent.role,
          },
        });
      })
    );
    setIsStoppingAllAgents(false);

    const failed = results
      .map((r, i) =>
        r.status === 'rejected' ? { role: stoppableAgents[i].role, reason: r.reason } : null
      )
      .filter(Boolean) as { role: string; reason: unknown }[];
    if (failed.length > 0) {
      const failedRoles = failed.map((f) => f.role).join(', ');
      const errorDetails = failed
        .map((f) => `${f.role}: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`)
        .join('; ');
      toast.error(`Failed to stop: ${failedRoles}`, {
        description: errorDetails,
      });
    } else {
      toast.success(`Stopped ${stoppableAgents.length} agent(s)`);
    }
  }, [agentPanelData, chatroomId]);

  // Restart all remote agents handler — starts if stopped, restarts if running
  const [isRestartingAllAgents, setIsRestartingAllAgents] = useState(false);
  const handleRestartAllRemoteAgents = useCallback(async () => {
    const agentRoles = getConfiguredAgentRoles();
    if (!agentRoles) return;

    const chatroomIdTyped = chatroomId as Id<'chatroom_rooms'>;
    const reportStartResults = (failed: string[], successMessage: string) => {
      if (failed.length > 0) {
        toast.error(`Failed to start: ${failed.join(', ')}`);
      } else {
        toast.success(successMessage);
      }
    };

    // Get current agent states
    const runningAgents = agentPanelData.agents.filter((a) => a.state === 'running');

    // Stop all running agents first
    if (runningAgents.length > 0) {
      setIsRestartingAllAgents(true);

      // Stop all running agents
      await Promise.allSettled(
        runningAgents.map((agent) =>
          agentPanelData.sendCommand({
            machineId: agent.machineId ?? ALL_MACHINES,
            type: 'stop-agent' as const,
            payload: {
              chatroomId: chatroomIdTyped,
              role: agent.role,
            },
          })
        )
      );

      // Wait a bit for agents to stop before starting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await runAgentStartBatch(
        agentRoles,
        roleConfigMap,
        chatroomIdTyped,
        agentPanelData.sendCommand,
        (failed) => reportStartResults(failed, `Restarted ${agentRoles.length} agent(s)`)
      );
      setIsRestartingAllAgents(false);
    } else {
      setIsRestartingAllAgents(true);
      await runAgentStartBatch(
        agentRoles,
        roleConfigMap,
        chatroomIdTyped,
        agentPanelData.sendCommand,
        (failed) => reportStartResults(failed, `Started ${agentRoles.length} agent(s)`)
      );
      setIsRestartingAllAgents(false);
    }
  }, [agentPanelData, roleConfigMap, chatroomId, getConfiguredAgentRoles]);

  const sourceControlPanel = useMemo(
    () => (
      <SourceControlPanel
        machineId={activeWorkspace?.machineId ?? ''}
        workingDir={activeWorkspace?.workingDir ?? ''}
        chatroomId={chatroomId}
        onSendSelectionToComposer={handleExplorerSelectionToComposer}
      />
    ),
    [
      activeWorkspace?.machineId,
      activeWorkspace?.workingDir,
      chatroomId,
      handleExplorerSelectionToComposer,
    ]
  );

  // Build command palette commands
  const { openDialog } = useCommandDialog();

  const handleOpenChatroomSwitcher = useCallback(() => {
    openDialog('switcher');
  }, [openDialog]);

  const handleCreateNewChatroom = useCallback(() => {
    router.push('/app?create=true');
  }, [router]);

  const handleOpenFileSelector = useCallback(() => {
    openDialog('file-selector');
  }, [openDialog]);

  // Handler to run a command from the command palette
  const handleRunCommand = useCallback(
    (commandName: string, script: string) => {
      void commandRunner.runOrAttach(commandName, script);
      setTerminalOpen(true);
    },
    [commandRunner]
  );

  // Detach palette output when switching chatrooms (don't kill the process).
  const inlineCommandRef = useRef(inlineCommand);
  inlineCommandRef.current = inlineCommand;
  useEffect(() => {
    return () => {
      inlineCommandRef.current.detach();
    };
  }, [chatroomId]);

  // Handler to open Processes panel from command palette
  const handleOpenProcessesPanel = useCallback(() => {
    setProcessesInitialCommand(null);
    setActivityView('processes');
  }, []);

  // Handler to open Processes panel with a specific command pre-selected
  const handleOpenProcessesPanelWithCommand = useCallback((commandName: string) => {
    setProcessesInitialCommand(commandName);
    setActivityView('processes');
  }, []);

  // Handler to run a command from Process Manager (opens PM, not terminal)
  const handleRunFromProcessesPanel = useCallback(
    (commandName: string, script: string) => {
      commandRunner.runCommand(commandName, script);
    },
    [commandRunner]
  );

  const handleRefreshWorkspaceState = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < REFRESH_COOLDOWN_MS) {
      toast('Refresh already in progress — please wait a moment');
      return;
    }
    lastRefreshRef.current = now;
    try {
      await recordObservationMutation({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        refresh: true,
      });
      // Observed-sync handles refresh via lastRefreshedAt on recordObservation.
      // requestGitRefreshMutation is an event-stream fallback for immediate git push.
      if (activeWorkspace?.machineId && activeWorkspace?.workingDir) {
        await requestGitRefreshMutation({
          machineId: activeWorkspace.machineId,
          workingDir: activeWorkspace.workingDir,
        });
      }
      toast.success('Workspace state refresh requested');
    } catch (err) {
      toast.error('Failed to refresh workspace state');
      console.error('Refresh workspace state failed:', err);
    }
  }, [
    activeWorkspace?.machineId,
    activeWorkspace?.workingDir,
    chatroomId,
    recordObservationMutation,
    requestGitRefreshMutation,
  ]);

  const commands = useCommandPaletteCommands({
    onOpenSettings: handleCmdOpenSettings,
    onOpenEventStream: handleCmdOpenEventStream,
    onOpenBacklog: handleCmdOpenBacklog,
    onCreateBacklogItem: handleCmdCreateBacklogItem,
    onOpenPendingReview: handleCmdOpenPendingReview,
    onOpenChatroomSwitcher: handleOpenChatroomSwitcher,
    onCreateNewChatroom: handleCreateNewChatroom,
    onOpenFileSelector: handleOpenFileSelector,
    onOpenInVSCode: isLocalWorkspace ? handleOpenInVSCode : null,
    onOpenInGitHubDesktop: isLocalWorkspace ? handleOpenInGitHubDesktop : null,
    onOpenPROnGitHub: prUrl ? handleOpenPROnGitHub : null,
    onViewGitHubPullRequests: gitHubRepoUrl ? handleViewGitHubPullRequests : null,
    onViewGitHubRepository: gitHubRepoUrl ? handleViewGitHubRepository : null,
    onSwitchToSourceControl: activeWorkspace ? handleSwitchToSourceControl : null,
    onSwitchToPullRequests: activeWorkspace ? handleSwitchToPullRequests : null,
    runnableCommands: commandRunner.commands,
    onOpenProcessesPanelWithCommand: handleOpenProcessesPanelWithCommand,
    onRunCommand: handleRunCommand,
    onOpenProcessesPanel: handleOpenProcessesPanel,
    onShowExplorer: activeWorkspace
      ? () => {
          setActivityView('explorer');
          setExplorerSidebarVisible(true);
          fileExplorerPanelRef.current?.refresh();
        }
      : null,
    onOpenAgenticSearch: activeWorkspace ? handleOpenAgenticQuery : null,
    onShowMessages: () => setActivityView('messages'),
    onToggleChatSplitPanel:
      activeView === 'explorer'
        ? () => setExplorerSplitViewEnabled(!explorerSplitViewEnabled)
        : null,
    workspaceCommands,
    onStartAllRemoteAgents: isStartingAllAgents ? null : handleStartAllRemoteAgents,
    onStopAllRemoteAgents: isStoppingAllAgents ? null : handleStopAllRemoteAgents,
    onRestartAllRemoteAgents: isRestartingAllAgents ? null : handleRestartAllRemoteAgents,
    onCreateCommand: (defaultScope?: SavedCommandScope) =>
      handleOpenSavedCommandModal(undefined, defaultScope),
    savedCommands,
    onExecuteSavedCommand: handleExecuteSavedCommand,
    onEditSavedCommand: handleEditSavedCommand,
    onDeleteSavedCommand: handleDeleteSavedCommand,
    confirmingDeleteCommandId,
    onRefreshWorkspaceState: handleRefreshWorkspaceState,
  });

  // Memoize the team entry point
  const teamEntryPoint = useMemo(
    () => getTeamEntryPoint({ teamEntryPoint: chatroom?.teamEntryPoint, teamRoles }) ?? 'builder',
    [chatroom?.teamEntryPoint, teamRoles]
  );

  const handleCloseModal = useCallback(() => {
    setModalState({
      isOpen: false,
      role: '',
    });
  }, []);

  // Open settings modal
  const handleOpenSettings = useCallback(() => {
    setSettingsInitialTab(undefined);
    setSettingsModalOpen(true);
  }, []);

  // Open settings modal directly to agents tab
  const handleOpenAgents = useCallback(() => {
    setSettingsInitialTab('agents');
    setSettingsModalOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsModalOpen(false);
    setSettingsInitialTab(undefined);
  }, []);

  // Open/close setup modal
  const handleOpenSetup = useCallback(() => {
    setSetupModalOpen(true);
  }, []);

  const handleCloseSetup = useCallback(() => {
    setSetupModalOpen(false);
  }, []);

  // Rename mutation (for setup modal)
  const renameChatroom = useSessionMutation(api.chatrooms.rename);

  // Rename handler for setup modal
  const handleRenameChatroom = useCallback(
    async (newName: string) => {
      await renameChatroom({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        name: newName.trim(),
      });
    },
    [renameChatroom, chatroomId]
  );

  // Show setup checklist only when the chatroom is brand new:
  // - No chat history (no user messages)
  // - Not all team members have joined yet
  // Once the chatroom has been used (hasHistory), never show setup again
  const isSetupMode = !allMembersJoined && !lifecycle?.hasHistory;

  // Derive display name
  const displayName = chatroom?.name || chatroom?.teamName || 'Chatroom';

  // Update browser tab title with chatroom name
  useEffect(() => {
    if (chatroom) {
      const previousTitle = document.title;
      document.title = `${displayName} | ${getAppTitle('Chatroom')}`;
      return () => {
        document.title = previousTitle;
      };
    }
  }, [chatroom, displayName]);

  // Inject chatroom controls into the app header
  useEffect(() => {
    // Only set header content when chatroom is loaded
    if (chatroom) {
      setHeaderContent({
        // Hide app title and user menu for immersive chatroom experience
        hideAppTitle: true,
        hideUserMenu: true,
        left: (
          <ChatroomHeaderLeft
            listingSidebarVisible={listingSidebarVisible}
            onToggleListingSidebar={onToggleListingSidebar}
          />
        ),
        center: (
          <ChatroomHeaderCenter
            onBack={onBack}
            onOpenSettings={handleOpenSettings}
            displayName={displayName}
            chatroomId={chatroomId}
          />
        ),
        right: (
          <div className="flex gap-2 md:gap-3 items-center">
            {/* Setup Button - shown when setup modal is dismissed but still in setup mode */}
            {isSetupMode && !setupModalOpen && (
              <button
                className="bg-chatroom-status-warning/15 border-2 border-chatroom-status-warning/30 text-chatroom-status-warning w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-status-warning/25 hover:border-chatroom-status-warning/50"
                onClick={handleOpenSetup}
                title="Open setup"
              >
                <Settings2 size={16} />
              </button>
            )}
            {/* Sidebar Toggle Button with Status Indicator */}
            <button
              className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary relative"
              onClick={toggleSidebar}
              title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              {/* Aggregate status indicator - shown when sidebar is hidden */}
              {!sidebarVisible && aggregateStatus !== 'none' && (
                <Square
                  size={8}
                  className={`absolute -top-1 -right-1 ${
                    aggregateStatus === 'working'
                      ? 'text-chatroom-status-info fill-chatroom-status-info'
                      : aggregateStatus === 'ready'
                        ? 'text-chatroom-status-success fill-chatroom-status-success'
                        : 'text-chatroom-text-muted fill-chatroom-text-muted'
                  }`}
                />
              )}
            </button>
          </div>
        ),
      });
    }

    // Clear header content when component unmounts
    return () => {
      clearHeaderContent();
    };
  }, [
    chatroom,
    chatroomId,
    isSetupMode,
    onBack,
    listingSidebarVisible,
    onToggleListingSidebar,
    sidebarVisible,
    aggregateStatus,
    toggleSidebar,
    setHeaderContent,
    clearHeaderContent,
    displayName,
    setupModalOpen,
    handleOpenSetup,
    handleOpenSettings,
    activeWorkspace,
  ]);

  // Wait for all required data and hydration before rendering to prevent flickering
  if (chatroom === undefined || lifecycle === undefined || isSmallScreen === undefined) {
    return (
      <div className="chatroom-root flex items-center justify-center h-full bg-chatroom-bg-primary text-chatroom-text-muted">
        <ChatroomLoader size="md" />
      </div>
    );
  }

  if (chatroom === null) {
    return (
      <div className="chatroom-root flex flex-col items-center justify-center h-full bg-chatroom-bg-primary text-chatroom-status-error">
        <div className="text-5xl mb-4">
          <XCircle size={48} />
        </div>
        <div>Chatroom not found</div>
        <div className="mt-2 text-chatroom-text-muted">ID: {chatroomId}</div>
      </div>
    );
  }

  return (
    <AttachmentsProvider>
      <PromptsProvider
        chatroomId={chatroomId}
        teamId={chatroom?.teamId}
        teamName={teamName}
        teamRoles={teamRoles}
        teamEntryPoint={teamEntryPoint}
      >
        <PendingFileHighlightProvider
          value={pendingFileHighlight}
          onChange={setPendingFileHighlight}
        >
          <WorkspaceFileLinkProvider onOpenFile={handleWorkspaceFileLinkClick}>
            <>
              <div className="chatroom-root flex flex-col h-full overflow-hidden bg-chatroom-bg-primary text-chatroom-text-primary font-sans">
                <div className="flex flex-1 overflow-hidden relative min-h-0">
                  {/* Activity Bar — VSCode-style icon sidebar (always render, even before workspace loads) */}
                  <ActivityBar activeView={activeView} onViewChange={handleActivityViewChange} />

                  {/* File Explorer Left Sidebar — shown in explorer view */}
                  {activeView === 'explorer' && activeWorkspace && explorerSidebarVisible && (
                    <div
                      className="relative shrink-0 border-r-2 border-chatroom-border-strong bg-chatroom-bg-surface overflow-hidden transition-all duration-200"
                      style={{ width: explorerSidebarWidth }}
                    >
                      <FileExplorerPanel
                        ref={fileExplorerPanelRef}
                        chatroomId={chatroomId}
                        machineId={activeWorkspace.machineId}
                        workingDir={activeWorkspace.workingDir}
                        fileTabs={fileTabs}
                        onFileSelect={handleFileSelect}
                        onFileDoubleClick={handleFileDoubleClick}
                        revealPath={revealPath}
                        activeTabPath={fileTabs.activeTabPath}
                        explorerSyncEnabled={explorerSyncEnabled}
                        onToggleSync={setExplorerSyncEnabled}
                      />
                      <ExplorerSidebarResizeHandle
                        widthPx={explorerSidebarWidth}
                        onWidthChange={setExplorerSidebarWidth}
                      />
                    </div>
                  )}

                  {/* Main Content Area */}
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {/* Content Toolbar — always renders, actions change based on active view */}
                    <WorkspaceHeaderRow className="justify-between gap-2 px-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {activeView === 'messages' && (
                          <MessageViewToggle
                            mode={messageViewMode}
                            onChange={setMessageViewMode}
                            teamRoles={teamRoles}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {(activeView === 'explorer' || activeView === 'source-control') && (
                          <button
                            className="w-6 h-6 hidden md:flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors cursor-pointer rounded-sm"
                            onClick={() => setExplorerSplitViewEnabled(!explorerSplitViewEnabled)}
                            title={
                              explorerSplitViewEnabled
                                ? 'Hide messages panel'
                                : 'Show messages panel'
                            }
                          >
                            {explorerSplitViewEnabled ? (
                              <MessageSquareOff size={14} />
                            ) : (
                              <MessageSquare size={14} />
                            )}
                          </button>
                        )}
                      </div>
                    </WorkspaceHeaderRow>

                    {/* When in explorer or source-control with split view enabled, show workspace + messages */}
                    {(activeView === 'explorer' || activeView === 'source-control') &&
                    explorerSplitViewEnabled ? (
                      <ResizablePanelGroup
                        className="flex-1 min-h-0"
                        onLayoutChanged={handleExplorerSplitLayoutChanged}
                      >
                        <ResizablePanel
                          id="explorer-split-left"
                          defaultSize={explorerSplitSizes[0]}
                          minSize={30}
                          className="flex flex-col min-h-0 overflow-hidden border-r border-chatroom-border"
                        >
                          {activeView === 'explorer' ? (
                            <ExplorerContent
                              fileTabs={fileTabs}
                              activeWorkspace={activeWorkspace}
                              autocompleteFiles={autocompleteFiles}
                              hasAutocompleteWorkspace={hasAutocompleteWorkspace}
                              onAtTriggerActivate={handleAtTriggerActivate}
                              onOpenPreview={handleOpenPreview}
                              onOpenTableView={handleOpenTableView}
                              onSendSelectionToComposer={handleExplorerSelectionToComposer}
                              agenticFocusToken={agenticFocusToken}
                            />
                          ) : (
                            sourceControlPanel
                          )}
                        </ResizablePanel>
                        <ResizableHandle />
                        <ResizablePanel
                          id="explorer-split-right"
                          defaultSize={explorerSplitSizes[1]}
                          minSize={25}
                          className="flex flex-col min-h-0 h-full overflow-hidden"
                        >
                          <RightSplitPanel
                            chatroomId={chatroomId as Id<'chatroom_rooms'>}
                            teamRoles={teamRoles}
                            messagesPanelProps={{
                              coordinator: timelineScrollCoordinator,
                              onRegisterOpenEventStream: handleRegisterOpenEventStream,
                              onRegisterMessageStoreActions: handleRegisterMessageStoreActions,
                              machines: machineNameMap,
                              onBeforeResize: beginResize,
                              onAfterResize: endResize,
                              onRegisterSendFormFocus: handleRegisterSendFormFocus,
                              autocompleteFiles,
                              refreshAutocompleteFiles: handleAtTriggerActivate,
                              hasAutocompleteWorkspace,
                            }}
                            selectedHarnessSessionId={selectedHarnessSessionId}
                            setSelectedHarnessSessionId={setSelectedHarnessSessionId}
                            mode={splitMode}
                            setMode={setSplitMode}
                          />
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    ) : activeView === 'messages' ? (
                      /* Message Feed — shown in messages view */
                      <ChatroomMessagesPanel
                        chatroomId={chatroomId}
                        coordinator={timelineScrollCoordinator}
                        onRegisterOpenEventStream={handleRegisterOpenEventStream}
                        onRegisterMessageStoreActions={handleRegisterMessageStoreActions}
                        machines={machineNameMap}
                        viewMode={messageViewMode}
                        footer={
                          <div className="shrink-0 border-t-2 border-chatroom-border-strong">
                            <MessageInput
                              chatroomId={chatroomId}
                              onBeforeResize={beginResize}
                              onAfterResize={endResize}
                              onRegisterFocus={handleRegisterSendFormFocus}
                              files={autocompleteFiles}
                              hasAutocompleteWorkspace={hasAutocompleteWorkspace}
                              onAtTriggerActivate={handleAtTriggerActivate}
                            />
                          </div>
                        }
                      />
                    ) : activeView === 'direct-harness' ? (
                      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        <DirectHarnessView chatroomId={chatroomId as Id<'chatroom_rooms'>} />
                      </div>
                    ) : activeView === 'source-control' ? (
                      sourceControlPanel
                    ) : activeView === 'pull-requests' ? (
                      /* Pull Requests — replaces the entire workspace area */
                      <PullRequestsPanel
                        machineId={activeWorkspace?.machineId ?? ''}
                        workingDir={activeWorkspace?.workingDir ?? ''}
                      />
                    ) : activeView === 'processes' ? (
                      /* Processes — command launcher / process manager */
                      <ProcessesPanel
                        machineId={activeWorkspace?.machineId}
                        workingDir={activeWorkspace?.workingDir}
                        commands={commandRunner.commands}
                        runs={commandRunner.runs}
                        activeRunOutput={activeRunOutput}
                        onRunCommand={handleRunFromProcessesPanel}
                        onStopCommand={(runId) => commandRunner.stopCommand(runId)}
                        onSelectRun={(runId) => commandRunner.setActiveRunId(runId)}
                        onClearRun={() => commandRunner.setActiveRunId(null)}
                        initialSelectedCommand={processesInitialCommand}
                        onConsumedInitialCommand={() => setProcessesInitialCommand(null)}
                      />
                    ) : (
                      /* Explorer view — file tabs + content or empty state (no split) */
                      <ExplorerContent
                        fileTabs={fileTabs}
                        activeWorkspace={activeWorkspace}
                        autocompleteFiles={autocompleteFiles}
                        hasAutocompleteWorkspace={hasAutocompleteWorkspace}
                        onAtTriggerActivate={handleAtTriggerActivate}
                        onOpenPreview={handleOpenPreview}
                        onOpenTableView={handleOpenTableView}
                        onSendSelectionToComposer={handleExplorerSelectionToComposer}
                        agenticFocusToken={agenticFocusToken}
                      />
                    )}
                  </div>

                  {/* Sidebar Overlay for mobile - below app header */}
                  {sidebarVisible && isSmallScreen && (
                    <div
                      className="fixed inset-0 top-14 bg-black/50 z-30 md:hidden"
                      onClick={toggleSidebar}
                    />
                  )}

                  {/* Sidebar - positioned below app header on mobile */}
                  {/* On desktop: transitions width to 0 when hidden so chat fills space */}
                  {/* On mobile: uses fixed positioning with translate for overlay effect */}
                  <div
                    className={`
                ${isSmallScreen ? 'fixed right-0 top-14 bottom-0 z-40 overscroll-contain w-80' : 'relative overflow-hidden'}
                ${!isSmallScreen && sidebarVisible ? 'w-80' : ''}
                ${!isSmallScreen && !sidebarVisible ? 'w-0' : ''}
                grid grid-rows-[auto_1fr] border-l-2 border-chatroom-border-strong
                ${isSmallScreen ? 'bg-chatroom-bg-primary' : 'bg-chatroom-bg-surface backdrop-blur-xl'}
                transition-all duration-300 ease-in-out
                ${isSmallScreen ? (sidebarVisible ? 'translate-x-0' : 'translate-x-full') : ''}
              `}
                  >
                    <AgentPanel
                      chatroomId={chatroomId}
                      teamRoles={teamRoles}
                      lifecycle={lifecycle}
                      teamName={chatroom.teamName}
                      teamId={chatroom.teamId}
                      defaultTeamId={defaultTeamId}
                      teams={teams}
                      onTeamChange={handleTeamChange}
                      agentConfigs={agentPanelData.machineConfigs}
                      onOpenAgents={handleOpenAgents}
                    />
                    <WorkQueue
                      chatroomId={chatroomId as Id<'chatroom_rooms'>}
                      lifecycle={lifecycle}
                      onRegisterActions={handleRegisterWorkQueueActions}
                      onTaskDeleted={handleTaskDeleted}
                    />
                  </div>
                </div>
                <WorkspaceBottomBar
                  workspaces={chatroomWorkspaces}
                  chatroomId={chatroomId}
                  refreshObservedChatroom={refreshObservedChatroom}
                  onSwitchToSourceControl={handleSwitchToSourceControl}
                />
              </div>

              <PromptModal
                isOpen={modalState.isOpen}
                onClose={handleCloseModal}
                role={modalState.role}
              />

              <AgentSettingsModal
                isOpen={settingsModalOpen}
                onClose={handleCloseSettings}
                chatroomId={chatroomId}
                currentTeamId={chatroom?.teamId}
                currentTeamRoles={teamRoles}
                initialTab={settingsInitialTab}
              />

              <FileSelectorModal
                open={fileSelector.open}
                onOpenChange={fileSelector.setOpen}
                files={fileSelector.files}
                recentFiles={fileSelector.recentFiles}
                onSelectFile={handleCmdPFileSelect}
                isLoading={fileSelector.isLoading}
                hasWorkspace={fileSelector.hasWorkspace}
              />

              <FilePreviewDialog
                filePath={!fileSelector.open ? fileSelector.selectedFile : null}
                machineId={activeWorkspace?.machineId ?? null}
                workingDir={activeWorkspace?.workingDir ?? null}
                onClose={handleFilePreviewClose}
                files={fileSelector.files}
                onSelectFile={fileSelector.selectFile}
                onOpenInExplorer={handleOpenInExplorer}
                onOpenFileOnRemote={handleOpenFileOnRemote}
              />

              {/* Setup modal - only shown during setup mode */}
              <SetupChecklistModal
                isOpen={isSetupMode && setupModalOpen}
                onClose={handleCloseSetup}
                chatroomId={chatroomId}
                teamRoles={teamRoles}
                teamEntryPoint={teamEntryPoint}
                participants={participants || []}
                chatroomName={displayName}
                onRenameChatroom={handleRenameChatroom}
              />

              {/* Saved Command Modal */}
              <SavedCommandModal
                isOpen={savedCommandModalOpen}
                chatroomId={chatroomId}
                onClose={handleCloseSavedCommandModal}
                initial={savedCommandEditTarget}
                existingNamesByScope={existingNamesByScope}
                defaultScope={savedCommandEditTarget ? undefined : savedCommandCreateScope}
              />

              {/* Command Palette (Cmd+Shift+P) */}
              <CommandPalette commands={commands} inlineCommand={inlineCommand} />
              <WorkspaceCommandsAggregator
                workspaces={chatroomWorkspaces}
                callbacks={workspaceCommandCallbacks}
                onCommandsChange={setWorkspaceCommands}
              />

              {/* Terminal Output Panel */}
              <TerminalOutputPanel
                open={terminalOpen}
                onOpenChange={setTerminalOpen}
                commandName={activeRunOutput.run?.commandName ?? null}
                status={activeRunOutput.run?.status ?? null}
                terminationReason={activeRunOutput.run?.terminationReason}
                output={activeRunOutput.chunks.map((c: any) => c.content).join('')}
                onStop={() => {
                  if (commandRunner.activeRunId) {
                    commandRunner.stopCommand(commandRunner.activeRunId);
                  }
                }}
                onRestart={() => {
                  const run = activeRunOutput.run;
                  if (run) {
                    const cmd = commandRunner.commands.find((c: any) => c.name === run.commandName);
                    if (cmd) {
                      handleRunCommand(cmd.name, cmd.script);
                    }
                  }
                }}
              />

              {/* Stop All Agents Confirmation Dialog */}
              <AlertDialog open={stopAllConfirmOpen} onOpenChange={setStopAllConfirmOpen}>
                <AlertDialogContent className="bg-chatroom-bg-primary border-chatroom-border-strong">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-chatroom-text-primary">
                      Stop all remote agents?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-chatroom-text-secondary">
                      This will terminate all running agents in this chatroom.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="border-t border-chatroom-border pt-4">
                    <AlertDialogCancel
                      onClick={() => setStopAllConfirmOpen(false)}
                      className="bg-chatroom-bg-tertiary border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary"
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={executeStopAllRemoteAgents}
                      className="bg-chatroom-status-error text-white hover:bg-chatroom-status-error/90 border-0"
                    >
                      Stop All Agents
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          </WorkspaceFileLinkProvider>
        </PendingFileHighlightProvider>
      </PromptsProvider>
    </AttachmentsProvider>
  );
}

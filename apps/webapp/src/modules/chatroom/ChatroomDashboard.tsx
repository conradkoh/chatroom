'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getTeamEntryPoint } from '@workspace/backend/src/domain/entities/team';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Files,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Settings2,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentPanel } from './components/AgentPanel';
import { AgentSettingsModal } from './components/AgentSettingsModal';
import { MessageFeed } from './components/MessageFeed';
import { PromptModal } from './components/PromptModal';
import { SendForm } from './components/SendForm';
import { SetupChecklistModal } from './components/SetupChecklistModal';
import { WorkQueue } from './components/WorkQueue';
import { AttachmentsProvider } from './context/AttachmentsContext';
import { CommandPalette, useCommandPaletteCommands, WorkspaceCommandsAggregator, type SettingsTab, type CommandItem } from './components/CommandPalette';
import { ProcessManager } from './components/ProcessManager';
import { TerminalOutputPanel } from './components/TerminalOutputPanel';
import { useCommandDialog } from './context/CommandDialogContext';
import { useAgentStatuses } from './hooks/useAgentStatuses';
import { useCommandRunner } from './hooks/useCommandRunner';
import { useScrollController } from './hooks/useScrollController';
import type { TeamLifecycle } from './types/readiness';
import { ActivityBar, type ActivityView } from './components/ActivityBar';
import { FileExplorerPanel, FILE_EXPLORER_REFRESH_EVENT } from './workspace/components/FileExplorerPanel';
import { FileContentViewer } from './workspace/components/FileContentViewer';
import { FileTabBar } from './workspace/components/FileTabBar';
import { RightPaneTabBar } from './workspace/components/RightPaneTabBar';
import { MarkdownPreviewPane } from './workspace/components/MarkdownPreviewPane';
import { CsvTablePane } from './workspace/components/CsvTablePane';
import { WorkspaceBottomBar } from './workspace/components/WorkspaceBottomBar';
import { useChatroomWorkspaces } from './workspace/hooks/useChatroomWorkspaces';
import { useFileTabs } from './workspace/hooks/useFileTabs';
import { useWorkspaceGit } from './workspace/hooks/useWorkspaceGit';
import { FileSelectorModal, FilePreviewDialog, useFileSelector } from './components/FileSelector';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PromptsProvider } from '@/contexts/PromptsContext';
import { cn } from '@/lib/utils';
import { useDaemonConnected } from '@/hooks/useDaemonConnected';
import { useSendLocalAction } from '@/hooks/useSendLocalAction';
import { getAppTitle } from '@/lib/environment';
import { openExternalUrl } from '@/lib/navigation';
import { toGitHubRepoUrl } from '@/lib/github';
import { useSetHeaderPortal } from '@/modules/header/HeaderPortalProvider';

// ─── Teams Config ────────────────────────────────────────────────────────────
// NOTE: For chatroom-themed floating popups/dropdowns, always use `bg-chatroom-bg-tertiary`
// (fully opaque) — NOT `bg-chatroom-bg-surface` (glassmorphism/semi-transparent).
// `bg-chatroom-bg-surface` is intended for overlapping panels with solid backgrounds,
// not for floating popovers that sit over arbitrary page content.

interface TeamDefinition {
  name: string;
  description: string;
  roles: string[];
  entryPoint?: string;
}

const TEAMS_CONFIG: { defaultTeam: string; teams: Record<string, TeamDefinition> } = {
  defaultTeam: 'duo',
  teams: {
    duo: {
      name: 'Duo',
      description: 'A planner and builder working as a pair',
      roles: ['planner', 'builder'],
      entryPoint: 'planner',
    },
    squad: {
      name: 'Squad',
      description: 'A planner, builder, and reviewer as a team',
      roles: ['planner', 'builder', 'reviewer'],
      entryPoint: 'planner',
    },
  },
};

interface ChatroomDashboardProps {
  chatroomId: string;
  onBack?: () => void;
}

/**
 * Memoized title editor component to prevent input recreation on every keystroke.
 * This component manages its own editing state to avoid triggering parent re-renders.
 */
interface ChatroomTitleEditorProps {
  displayName: string;
  chatroomId: string;
}

const ChatroomTitleEditor = memo(function ChatroomTitleEditor({
  displayName,
  chatroomId,
}: ChatroomTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const renameChatroom = useSessionMutation(api.chatrooms.rename);

  const handleStartEdit = useCallback(() => {
    setEditedName(displayName);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [displayName]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditedName('');
  }, []);

  const handleSave = useCallback(async () => {
    if (!editedName.trim()) {
      handleCancel();
      return;
    }
    setIsPending(true);
    try {
      await renameChatroom({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        name: editedName.trim(),
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to rename chatroom:', error);
    } finally {
      setIsPending(false);
    }
  }, [editedName, renameChatroom, chatroomId, handleCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="bg-chatroom-bg-tertiary border-2 border-chatroom-border-strong text-chatroom-text-primary px-2 py-1 text-xs font-bold uppercase tracking-wide w-32 sm:w-48 focus:outline-none focus:border-chatroom-accent"
          placeholder="Enter name..."
          disabled={isPending}
          maxLength={100}
        />
        <button
          className="bg-transparent border-2 border-chatroom-border text-chatroom-status-success w-6 h-6 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-status-success disabled:opacity-50"
          onClick={handleSave}
          disabled={isPending}
          title="Save name"
        >
          <Check size={12} />
        </button>
        <button
          className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-6 h-6 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
          onClick={handleCancel}
          disabled={isPending}
          title="Cancel"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-chatroom-text-primary text-xs font-bold uppercase tracking-wide max-w-[120px] sm:max-w-[200px] truncate">
        {displayName}
      </span>
      <button
        className="bg-transparent border-0 text-chatroom-text-muted w-5 h-5 flex items-center justify-center cursor-pointer transition-all duration-100 hover:text-chatroom-text-secondary"
        onClick={handleStartEdit}
        title="Rename chatroom"
      >
        <Pencil size={12} />
      </button>
    </div>
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

export function ChatroomDashboard({ chatroomId, onBack }: ChatroomDashboardProps) {
  // ─── Scroll controller (shared between MessageFeed and SendForm) ───
  const {
    controller: scrollController,
    isPinned,
    scrollToBottom,
    beginResize,
    endResize,
  } = useScrollController();

  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    role: '',
  });

  // Agent settings modal state
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);

  // Terminal output panel state
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Process Manager state
  const [processManagerOpen, setProcessManagerOpen] = useState(false);
  const [processManagerInitialCommand, setProcessManagerInitialCommand] = useState<string | null>(null);

  // Setup checklist modal state - starts open
  const [setupModalOpen, setSetupModalOpen] = useState(true);

  // Sidebar visibility state - hidden by default on small screens
  const isSmallScreen = useIsSmallScreen();
  const [sidebarVisible, setSidebarVisible] = useState(!isSmallScreen);

  // Activity bar — single active view at a time
  const [activeView, setActiveView] = useState<ActivityView>('messages');

  // Explorer sidebar sub-state: visible (sidebar+preview) or hidden (preview-only)
  const [explorerSidebarVisible, setExplorerSidebarVisible] = useState(!isSmallScreen);

  // Handle ActivityBar view changes with toggle sub-state support
  const focusSendFormRef = useRef<(() => void) | null>(null);

  const handleRegisterSendFormFocus = useCallback((fn: () => void) => {
    focusSendFormRef.current = fn;
  }, []);

  const handleActivityViewChange = useCallback((view: ActivityView) => {
    if (view === activeView) {
      // Already on this view — toggle sub-state
      if (view === 'explorer') {
        setExplorerSidebarVisible(prev => !prev);
      }
    } else {
      // Switch to different view
      setActiveView(view);
      // Focus message input when switching to messages
      if (view === 'messages') {
        setTimeout(() => focusSendFormRef.current?.(), 0);
      }
    }
  }, [activeView]);

  // File tabs state
  const fileTabs = useFileTabs();

  // File select handler: single click = preview, double click = pin
  const handleFileSelect = useCallback((filePath: string) => {
    fileTabs.openPreview(filePath);
  }, [fileTabs.openPreview]);

  const handleFileDoubleClick = useCallback((filePath: string) => {
    fileTabs.pinTab(filePath);
  }, [fileTabs.pinTab]);

  // Track the path to reveal in the file tree
  const [revealPath, setRevealPath] = useState<string | null>(null);

  // Right pane handlers
  const handleOpenPreview = useCallback((filePath: string) => {
    fileTabs.openRight(filePath, 'preview');
  }, [fileTabs.openRight]);

  const handleOpenTableView = useCallback((filePath: string) => {
    fileTabs.openRight(filePath, 'table');
  }, [fileTabs.openRight]);

  // Update sidebar visibility when screen size changes
  useEffect(() => {
    setSidebarVisible(!isSmallScreen);
    setExplorerSidebarVisible(!isSmallScreen);
  }, [isSmallScreen]);

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
    setSidebarVisible((prev) => !prev);
  }, []);

  // Header portal integration
  const { setContent: setHeaderContent, clearContent: clearHeaderContent } = useSetHeaderPortal();

  const chatroom = useSessionQuery(api.chatrooms.get, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Chatroom | null | undefined;

  // Update team mutation (for switching teams)
  const updateTeam = useSessionMutation(api.chatrooms.updateTeam);

  // Mark chatroom as read mutation (for unread indicators)
  const markAsRead = useSessionMutation(api.chatrooms.markAsRead);

  // Mark chatroom as read when it loads (and periodically while viewing)
  useEffect(() => {
    if (!chatroom) return;

    // Mark as read immediately when viewing
    markAsRead({ chatroomId: chatroomId as Id<'chatroom_rooms'> }).catch(() => {
      // Silently ignore - non-critical
    });

    // Also mark as read periodically while viewing (every 30s)
    // This ensures the cursor stays updated for long sessions
    const interval = setInterval(() => {
      markAsRead({ chatroomId: chatroomId as Id<'chatroom_rooms'> }).catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, [chatroom, chatroomId, markAsRead]);

  const lifecycle = useSessionQuery(api.participants.getTeamLifecycle, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamLifecycle | null | undefined;

  const activeTask = useSessionQuery(api.tasks.getActiveTask, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

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

  // Workspace bar data
  const { workspaces: chatroomWorkspaces } = useChatroomWorkspaces(chatroomId);

  // File selector (Cmd+P)
  const firstWorkspace = chatroomWorkspaces.find((ws) => ws.machineId);
  const fileSelector = useFileSelector({
    machineId: firstWorkspace?.machineId ?? null,
    workingDir: firstWorkspace?.workingDir ?? null,
  });

  const handleOpenInExplorer = useCallback((filePath: string) => {
    fileTabs.pinTab(filePath);
    setActiveView('explorer');
    setExplorerSidebarVisible(true);
    setRevealPath(filePath);
  }, [fileTabs.pinTab]);

  // Handler for Cmd+P file selection — opens as pinned tab and reveals in tree
  const handleCmdPFileSelect = useCallback((filePath: string) => {
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
  }, [fileSelector, activeView, handleOpenInExplorer]);

  // Command runner (for Cmd+Shift+P "Run Script" commands)
  const commandRunner = useCommandRunner({
    machineId: firstWorkspace?.machineId ?? null,
    workingDir: firstWorkspace?.workingDir ?? null,
  });

  // ─── Command Palette (Cmd+Shift+P) ────────────────────────────────────────
  // Refs to hold imperative open callbacks registered by child components
  const openGitPanelRef = useRef<((tab?: string) => void) | null>(null);
  const openEventStreamRef = useRef<(() => void) | null>(null);
  const openBacklogRef = useRef<(() => void) | null>(null);
  const openPendingReviewRef = useRef<(() => void) | null>(null);

  // Registration callbacks (stable refs, no re-renders)
  const handleRegisterOpenGitPanel = useCallback((fn: (tab?: string) => void) => {
    openGitPanelRef.current = fn;
  }, []);

  const handleRegisterOpenEventStream = useCallback((fn: () => void) => {
    openEventStreamRef.current = fn;
  }, []);

  const handleRegisterWorkQueueActions = useCallback(
    (actions: { openBacklog: () => void; openPendingReview: () => void }) => {
      openBacklogRef.current = actions.openBacklog;
      openPendingReviewRef.current = actions.openPendingReview;
    },
    []
  );

  // Command palette open handlers — delegate to child refs
  const handleCmdOpenSettings = useCallback(
    (tab: SettingsTab) => {
      setSettingsInitialTab(tab);
      setSettingsModalOpen(true);
    },
    []
  );

  const handleCmdOpenGitPanel = useCallback(() => {
    openGitPanelRef.current?.();
  }, []);

  const handleCmdOpenPRReview = useCallback(() => {
    openGitPanelRef.current?.('prs');
  }, []);

  const handleCmdOpenEventStream = useCallback(() => {
    openEventStreamRef.current?.();
  }, []);

  const handleCmdOpenBacklog = useCallback(() => {
    openBacklogRef.current?.();
  }, []);

  const handleCmdOpenPendingReview = useCallback(() => {
    openPendingReviewRef.current?.();
  }, []);

  // ─── Workspace context for command palette actions ─────────────────────────
  const { isConnected: isLocalWorkspace } = useDaemonConnected(firstWorkspace?.machineId ?? null);
  const sendAction = useSendLocalAction();
  const gitState = useWorkspaceGit(
    firstWorkspace?.machineId ?? '',
    firstWorkspace?.workingDir ?? ''
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
    return toGitHubRepoUrl(origin.url);
  }, [gitState]);

  // Action command callbacks — stable, conditionally nulled
  const handleOpenInVSCode = useCallback(() => {
    if (firstWorkspace?.machineId && firstWorkspace?.workingDir) {
      sendAction(firstWorkspace.machineId, 'open-vscode', firstWorkspace.workingDir);
    }
  }, [firstWorkspace?.machineId, firstWorkspace?.workingDir, sendAction]);

  const handleOpenInGitHubDesktop = useCallback(() => {
    if (firstWorkspace?.machineId && firstWorkspace?.workingDir) {
      sendAction(firstWorkspace.machineId, 'open-github-desktop', firstWorkspace.workingDir);
    }
  }, [firstWorkspace?.machineId, firstWorkspace?.workingDir, sendAction]);

  const handleOpenPROnGitHub = useCallback(() => {
    if (prUrl) openExternalUrl(prUrl);
  }, [prUrl]);

  const handleViewGitHubPullRequests = useCallback(() => {
    if (gitHubRepoUrl) openExternalUrl(`${gitHubRepoUrl}/pulls`);
  }, [gitHubRepoUrl]);

  const handleViewGitHubRepository = useCallback(() => {
    if (gitHubRepoUrl) openExternalUrl(gitHubRepoUrl);
  }, [gitHubRepoUrl]);

  // ─── Multi-workspace command palette commands ──────────────────────────────
  const [workspaceCommands, setWorkspaceCommands] = useState<CommandItem[]>([]);
  const workspaceCommandCallbacks = useMemo(() => ({
    sendAction,
    openExternalUrl,
    onOpenGitPanel: () => openGitPanelRef.current?.(),
  }), [sendAction]);

  // Build command palette commands
  const { openDialog } = useCommandDialog();

  const handleOpenChatroomSwitcher = useCallback(() => {
    openDialog('switcher');
  }, [openDialog]);

  const handleOpenFileSelector = useCallback(() => {
    openDialog('file-selector');
  }, [openDialog]);

  // Handler to run a command from the command palette
  const handleRunCommand = useCallback(
    (commandName: string, script: string) => {
      commandRunner.runCommand(commandName, script);
      setTerminalOpen(true);
    },
    [commandRunner]
  );

  // Handler to open Process Manager from command palette
  const handleOpenProcessManager = useCallback(() => {
    setProcessManagerInitialCommand(null);
    setProcessManagerOpen(true);
  }, []);

  // Handler to open Process Manager with a specific command pre-selected
  const handleOpenProcessManagerWithCommand = useCallback((commandName: string) => {
    setProcessManagerInitialCommand(commandName);
    setProcessManagerOpen(true);
  }, []);

  // Handler to run a command from Process Manager (opens PM, not terminal)
  const handleRunFromProcessManager = useCallback(
    (commandName: string, script: string) => {
      commandRunner.runCommand(commandName, script);
    },
    [commandRunner]
  );

  const commands = useCommandPaletteCommands({
    onOpenSettings: handleCmdOpenSettings,
    onOpenEventStream: handleCmdOpenEventStream,
    onOpenGitPanel: handleCmdOpenGitPanel,
    onOpenBacklog: handleCmdOpenBacklog,
    onOpenPendingReview: handleCmdOpenPendingReview,
    onOpenChatroomSwitcher: handleOpenChatroomSwitcher,
    onOpenFileSelector: handleOpenFileSelector,
    onOpenInVSCode: isLocalWorkspace ? handleOpenInVSCode : null,
    onOpenInGitHubDesktop: isLocalWorkspace ? handleOpenInGitHubDesktop : null,
    onOpenPROnGitHub: prUrl ? handleOpenPROnGitHub : null,
    onOpenPRReview: prUrl ? handleCmdOpenPRReview : null,
    onViewGitHubPullRequests: gitHubRepoUrl ? handleViewGitHubPullRequests : null,
    onViewGitHubRepository: gitHubRepoUrl ? handleViewGitHubRepository : null,
    onOpenWorkspaceDetails: firstWorkspace ? handleCmdOpenGitPanel : null,
    runnableCommands: commandRunner.commands,
    onOpenProcessManagerWithCommand: handleOpenProcessManagerWithCommand,
    onRunCommand: handleRunCommand,
    onOpenProcessManager: handleOpenProcessManager,
    onShowExplorer: firstWorkspace
      ? () => {
          setActiveView('explorer');
          setExplorerSidebarVisible(true);
          // Dispatch refresh event so the file tree reloads
          window.dispatchEvent(new Event(FILE_EXPLORER_REFRESH_EVENT));
        }
      : null,
    onShowMessages: () => setActiveView('messages'),
    workspaceCommands,
  });

  // Memoize the team entry point
  const teamEntryPoint = useMemo(
    () => getTeamEntryPoint({ teamEntryPoint: chatroom?.teamEntryPoint, teamRoles }) ?? 'builder',
    [chatroom?.teamEntryPoint, teamRoles]
  );

  // Memoize callbacks to prevent unnecessary child re-renders
  const handleViewPrompt = useCallback((role: string) => {
    setModalState({
      isOpen: true,
      role,
    });
  }, []);

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

  // Status badge colors - using chatroom status variables for theme support
  const getStatusBadgeClasses = useCallback((status: string, isSetup: boolean) => {
    const base =
      'px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide inline-flex items-center border-2 border-transparent';
    if (isSetup) return `${base} bg-chatroom-status-warning/15 text-chatroom-status-warning`;
    switch (status) {
      case 'active':
        return `${base} bg-chatroom-status-success/15 text-chatroom-status-success`;
      case 'completed':
        return `${base} bg-chatroom-status-info/15 text-chatroom-status-info`;
      default:
        return `${base} bg-chatroom-text-muted/15 text-chatroom-text-muted`;
    }
  }, []);

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
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
                onClick={onBack}
                title="Back to chatroom list"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            {/* Chatroom Name - Editable */}
            <ChatroomTitleEditor displayName={displayName} chatroomId={chatroomId} />
          </div>
        ),
        right: (
          <div className="flex gap-2 md:gap-3 items-center">
            {chatroom.teamName && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button className="bg-chatroom-bg-tertiary border-2 border-transparent px-2 md:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-secondary hidden sm:flex items-center gap-1.5 cursor-pointer transition-all duration-100 hover:border-chatroom-border hover:text-chatroom-text-primary focus:outline-none">
                    Team: {chatroom.teamName}
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[200px] bg-chatroom-bg-tertiary border-2 border-chatroom-border rounded-none p-0"
                >
                  {Object.entries(TEAMS_CONFIG.teams).map(([teamId, teamData]) => {
                    const isActive = teamId === (chatroom.teamId || TEAMS_CONFIG.defaultTeam);
                    return (
                      <DropdownMenuItem
                        key={teamId}
                        onClick={async () => {
                          if (isActive) return;
                          await updateTeam({
                            chatroomId: chatroomId as Id<'chatroom_rooms'>,
                            teamId,
                            teamName: teamData.name,
                            teamRoles: teamData.roles,
                            teamEntryPoint: teamData.entryPoint || teamData.roles[0],
                          });
                        }}
                        className={`flex items-center justify-between px-3 py-2.5 cursor-pointer border-b border-chatroom-border last:border-b-0 rounded-none transition-colors duration-100 ${
                          isActive
                            ? 'bg-chatroom-accent/5 text-chatroom-text-primary'
                            : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary'
                        }`}
                      >
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
                            {teamData.name}
                          </div>
                          <div className="text-[10px] text-chatroom-text-muted mt-0.5">
                            {teamData.roles.join(' · ')}
                          </div>
                        </div>
                        {isActive && (
                          <Check size={12} className="text-chatroom-accent ml-2 shrink-0" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator className="bg-chatroom-border-strong m-0" />
                  <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                    Agents must reconnect after switching
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <span className={getStatusBadgeClasses(chatroom.status, isSetupMode)}>
              {isSetupMode ? 'Setting Up' : chatroom.status}
            </span>
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
    sidebarVisible,
    aggregateStatus,
    toggleSidebar,
    setHeaderContent,
    clearHeaderContent,
    getStatusBadgeClasses,
    displayName,
    setupModalOpen,
    handleOpenSetup,
    firstWorkspace,
  ]);

  // Wait for all required data and hydration before rendering to prevent flickering
  if (chatroom === undefined || lifecycle === undefined || isSmallScreen === undefined) {
    return (
      <div className="chatroom-root flex items-center justify-center h-full bg-chatroom-bg-primary text-chatroom-text-muted">
        <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
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
        <>
          <div className="chatroom-root flex flex-col h-full overflow-hidden bg-chatroom-bg-primary text-chatroom-text-primary font-sans">
            <div className="flex flex-1 overflow-hidden relative min-h-0">
              {/* Activity Bar — VSCode-style icon sidebar */}
              {firstWorkspace && (
                <ActivityBar
                  activeView={activeView}
                  onViewChange={handleActivityViewChange}
                />
              )}

              {/* File Explorer Left Sidebar — shown in explorer view */}
              {activeView === 'explorer' && firstWorkspace && !fileTabs.expandedTabPath && explorerSidebarVisible && (
                <div
                  className="relative shrink-0 w-64 border-r-2 border-chatroom-border-strong bg-chatroom-bg-surface overflow-hidden transition-all duration-200"
                >
                  <FileExplorerPanel
                    machineId={firstWorkspace.machineId}
                    workingDir={firstWorkspace.workingDir}
                    onFileSelect={handleFileSelect}
                    onFileDoubleClick={handleFileDoubleClick}
                    revealPath={revealPath}
                  />
                </div>
              )}

              {/* Main Content Area */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {activeView === 'messages' ? (
                  /* Message Feed — shown in messages view */
                  <MessageFeed
                    chatroomId={chatroomId}
                    activeTask={activeTask}
                    controller={scrollController}
                    isPinned={isPinned}
                    scrollToBottom={scrollToBottom}
                    onRegisterOpenEventStream={handleRegisterOpenEventStream}
                  />
                ) : (
                  /* Explorer view — file tabs + content or empty state */
                  <>
                    {/* File Tab Bar — shown when tabs are open */}
                    {fileTabs.tabs.length > 0 && (
                      <FileTabBar
                        tabs={fileTabs.tabs}
                        activeTabPath={fileTabs.activeTabPath}
                        onActivate={fileTabs.setActiveTab}
                        onClose={fileTabs.closeTab}
                        onPin={fileTabs.pinTab}
                        onToggleExpanded={fileTabs.toggleExpanded}
                      />
                    )}

                    {/* File Content Area — left pane + optional right pane */}
                    {fileTabs.activeTabPath && firstWorkspace?.machineId && firstWorkspace?.workingDir ? (
                      <div className="flex-1 flex min-h-0 overflow-hidden">
                        {/* Left Pane — source code */}
                        <div className={cn(
                          'flex flex-col min-h-0 overflow-hidden',
                          fileTabs.rightTabs.length > 0 ? 'w-1/2 border-r border-chatroom-border' : 'flex-1'
                        )}>
                          <FileContentViewer
                            key={fileTabs.activeTabPath}
                            machineId={firstWorkspace.machineId}
                            workingDir={firstWorkspace.workingDir}
                            filePath={fileTabs.activeTabPath}
                            onOpenPreview={handleOpenPreview}
                            onOpenTableView={handleOpenTableView}
                          />
                        </div>

                        {/* Right Pane — preview/table */}
                        {fileTabs.rightTabs.length > 0 && (
                          <div className="w-1/2 flex flex-col min-h-0 overflow-hidden">
                            <RightPaneTabBar
                              tabs={fileTabs.rightTabs}
                              activeTabKey={fileTabs.activeRightTabKey}
                              onActivate={fileTabs.setActiveRightTab}
                              onClose={fileTabs.closeRight}
                            />
                            {(() => {
                              const activeRight = fileTabs.rightTabs.find(t => t.key === fileTabs.activeRightTabKey);
                              if (!activeRight) return null;
                              if (activeRight.viewType === 'preview') {
                                return (
                                  <MarkdownPreviewPane
                                    key={activeRight.key}
                                    machineId={firstWorkspace.machineId!}
                                    workingDir={firstWorkspace.workingDir!}
                                    filePath={activeRight.filePath}
                                  />
                                );
                              }
                              if (activeRight.viewType === 'table') {
                                return (
                                  <CsvTablePane
                                    key={activeRight.key}
                                    machineId={firstWorkspace.machineId!}
                                    workingDir={firstWorkspace.workingDir!}
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
                          <p className="text-xs mt-1">Select a file from the explorer to view it</p>
                        </div>
                      </div>
                    )}
                  </>
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
                  onConfigure={handleOpenSettings}
                  onOpenAgents={handleOpenAgents}
                />
                <WorkQueue chatroomId={chatroomId} lifecycle={lifecycle} onRegisterActions={handleRegisterWorkQueueActions} />
              </div>
            </div>
            {/* SendForm row — border-t-2 spans both main content and sidebar */}
            <div className="shrink-0 border-t-2 border-chatroom-border-strong">
                <SendForm
                  chatroomId={chatroomId}
                  onBeforeResize={beginResize}
                  onAfterResize={endResize}
                  onRegisterFocus={handleRegisterSendFormFocus}
                />
            </div>
            <WorkspaceBottomBar workspaces={chatroomWorkspaces} chatroomId={chatroomId} onRegisterOpenGitPanel={handleRegisterOpenGitPanel} />
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
            machineId={firstWorkspace?.machineId ?? null}
            workingDir={firstWorkspace?.workingDir ?? null}
            onClose={() => fileSelector.selectFile('')}
            files={fileSelector.files}
            onSelectFile={fileSelector.selectFile}
            onOpenInExplorer={handleOpenInExplorer}
          />

          {/* Setup modal - only shown during setup mode */}
          <SetupChecklistModal
            isOpen={isSetupMode && setupModalOpen}
            onClose={handleCloseSetup}
            chatroomId={chatroomId}
            teamName={teamName}
            teamRoles={teamRoles}
            teamEntryPoint={teamEntryPoint}
            participants={participants || []}
            onViewPrompt={handleViewPrompt}
            chatroomName={displayName}
            onRenameChatroom={handleRenameChatroom}
          />

          {/* Command Palette (Cmd+Shift+P) */}
          <CommandPalette commands={commands} />
          <WorkspaceCommandsAggregator
            workspaces={chatroomWorkspaces}
            callbacks={workspaceCommandCallbacks}
            onCommandsChange={setWorkspaceCommands}
          />

          {/* Terminal Output Panel */}
          <TerminalOutputPanel
            open={terminalOpen}
            onOpenChange={setTerminalOpen}
            commandName={commandRunner.activeRunOutput.run?.commandName ?? null}
            status={commandRunner.activeRunOutput.run?.status ?? null}
            output={commandRunner.activeRunOutput.chunks.map((c: any) => c.content).join('')}
            onStop={() => {
              if (commandRunner.activeRunId) {
                commandRunner.stopCommand(commandRunner.activeRunId);
              }
            }}
            onRestart={() => {
              const run = commandRunner.activeRunOutput.run;
              if (run) {
                const cmd = commandRunner.commands.find((c: any) => c.name === run.commandName);
                if (cmd) {
                  handleRunCommand(cmd.name, cmd.script);
                }
              }
            }}
          />

          {/* Process Manager */}
          <ProcessManager
            open={processManagerOpen}
            onOpenChange={setProcessManagerOpen}
            commands={commandRunner.commands as any[]}
            runs={commandRunner.runs as any[]}
            activeRunOutput={commandRunner.activeRunOutput as any}
            onRunCommand={handleRunFromProcessManager}
            onStopCommand={(runId) => commandRunner.stopCommand(runId)}
            onSelectRun={(runId) => commandRunner.setActiveRunId(runId)}
            onClearRun={() => commandRunner.setActiveRunId(null)}
            initialSelectedCommand={processManagerInitialCommand}
          />
        </>
      </PromptsProvider>
    </AttachmentsProvider>
  );
}

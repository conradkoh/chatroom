'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  ArrowLeft,
  XCircle,
  PanelRightOpen,
  PanelRightClose,
  Pencil,
  Check,
  X,
  CheckCircle,
  MoreVertical,
  Square,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';

import { AgentPanel } from './components/AgentPanel';
import { MessageFeed } from './components/MessageFeed';
import { PromptModal } from './components/PromptModal';
import { ReconnectModal } from './components/ReconnectModal';
import { SendForm } from './components/SendForm';
import { SetupChecklist } from './components/SetupChecklist';
import { TaskQueue } from './components/TaskQueue';
import { AttachedTasksProvider } from './context/AttachedTasksContext';
// TeamStatus is now consolidated into AgentPanel

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PromptsProvider } from '@/contexts/PromptsContext';
import { useSetHeaderPortal } from '@/modules/header/HeaderPortalProvider';

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

  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;
  const renameChatroom = useSessionMutation(chatroomApi.chatrooms.rename);

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

interface Participant {
  _id: string;
  chatroomId: string;
  role: string;
  status: string;
  readyUntil?: number;
  activeUntil?: number;
}

interface ParticipantInfo {
  role: string;
  status: string;
  readyUntil?: number;
  isExpired: boolean;
}

interface TeamReadiness {
  isReady: boolean;
  teamName: string;
  expectedRoles: string[];
  missingRoles: string[];
  expiredRoles?: string[];
  participants?: ParticipantInfo[];
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
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    role: '',
  });

  // Reconnect modal state
  const [reconnectModalOpen, setReconnectModalOpen] = useState(false);

  // Sidebar visibility state - hidden by default on small screens
  const isSmallScreen = useIsSmallScreen();
  const [sidebarVisible, setSidebarVisible] = useState(!isSmallScreen);

  // Update sidebar visibility when screen size changes
  useEffect(() => {
    setSidebarVisible(!isSmallScreen);
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

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const chatroom = useSessionQuery(chatroomApi.chatrooms.get, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Chatroom | null | undefined;

  // Update status mutation (for marking complete)
  const updateStatus = useSessionMutation(chatroomApi.chatrooms.updateStatus);

  const participants = useSessionQuery(chatroomApi.participants.list, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Participant[] | undefined;

  const readiness = useSessionQuery(chatroomApi.chatrooms.getTeamReadiness, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamReadiness | null | undefined;

  // Memoize derived values
  const teamRoles = useMemo(() => chatroom?.teamRoles || [], [chatroom?.teamRoles]);
  const teamName = useMemo(() => chatroom?.teamName || 'Team', [chatroom?.teamName]);

  // Create a memoized map of roles to participants
  const participantMap = useMemo(
    () => new Map((participants || []).map((p) => [p.role.toLowerCase(), p])),
    [participants]
  );

  // Check if all team members have joined (memoized)
  const allMembersJoined = useMemo(
    () => teamRoles.every((role) => participantMap.has(role.toLowerCase())),
    [teamRoles, participantMap]
  );

  // Compute aggregate status for sidebar indicator
  // Blue (working) if any agent is active, Green (ready) if all are waiting
  // Must check expiration timestamps to detect disconnected agents
  const aggregateStatus = useMemo(() => {
    if (!participants || participants.length === 0) return 'none';
    const nonUserParticipants = participants.filter((p) => p.role.toLowerCase() !== 'user');
    if (nonUserParticipants.length === 0) return 'none';

    const now = Date.now();

    // Check if any agent has expired (disconnected)
    // - Active agents expire based on activeUntil
    // - Waiting agents expire based on readyUntil
    const isExpired = (p: Participant): boolean => {
      if (p.status === 'active') {
        return p.activeUntil ? p.activeUntil < now : false;
      }
      if (p.status === 'waiting') {
        return p.readyUntil ? p.readyUntil < now : false;
      }
      return false;
    };

    // Filter to get non-expired agents
    const connectedAgents = nonUserParticipants.filter((p) => !isExpired(p));

    // If any agent is expired, check if we have enough connected agents
    const hasDisconnected = nonUserParticipants.some(isExpired);
    if (hasDisconnected && connectedAgents.length === 0) return 'partial';

    // Check for active non-expired agents
    const hasActiveAgent = connectedAgents.some((p) => p.status === 'active');
    if (hasActiveAgent) return 'working';

    // All non-expired agents must be waiting for "ready" status
    const allReady =
      connectedAgents.length > 0 &&
      connectedAgents.every((p) => p.status === 'waiting' || p.status === 'active');
    if (allReady && !hasDisconnected) return 'ready';

    return 'partial';
  }, [participants]);

  // Memoize the team entry point
  const teamEntryPoint = useMemo(
    () => chatroom?.teamEntryPoint || teamRoles[0] || 'builder',
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

  // Reconnect modal handlers
  const handleOpenReconnect = useCallback(() => {
    setReconnectModalOpen(true);
  }, []);

  const handleCloseReconnect = useCallback(() => {
    setReconnectModalOpen(false);
  }, []);

  // Mark complete handler
  const handleMarkComplete = useCallback(async () => {
    try {
      await updateStatus({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        status: 'completed',
      });
      // Navigate back after marking complete
      if (onBack) {
        onBack();
      }
    } catch (error) {
      console.error('Failed to mark as complete:', error);
    }
  }, [updateStatus, chatroomId, onBack]);

  // Show setup checklist if not all members have joined
  const isSetupMode = !allMembersJoined;

  // Check if team has disconnected (expired) agents
  const hasDisconnectedAgents = useMemo(() => {
    return readiness?.expiredRoles && readiness.expiredRoles.length > 0;
  }, [readiness?.expiredRoles]);

  // Determine if team is not ready due to disconnection (vs initial setup)
  const isTeamDisconnected = useMemo(() => {
    return !isSetupMode && !readiness?.isReady && !!hasDisconnectedAgents;
  }, [isSetupMode, readiness?.isReady, hasDisconnectedAgents]);

  // Status badge colors - using chatroom status variables for theme support
  const getStatusBadgeClasses = useCallback(
    (status: string, isSetup: boolean, isDisconnected: boolean) => {
      const base = 'px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide';
      if (isDisconnected) return `${base} bg-chatroom-status-error/15 text-chatroom-status-error`;
      if (isSetup) return `${base} bg-chatroom-status-warning/15 text-chatroom-status-warning`;
      switch (status) {
        case 'active':
          return `${base} bg-chatroom-status-success/15 text-chatroom-status-success`;
        case 'completed':
          return `${base} bg-chatroom-status-info/15 text-chatroom-status-info`;
        default:
          return `${base} bg-chatroom-text-muted/15 text-chatroom-text-muted`;
      }
    },
    []
  );

  // Derive display name
  const displayName = chatroom?.name || chatroom?.teamName || 'Chatroom';

  // Update browser tab title with chatroom name
  useEffect(() => {
    if (chatroom) {
      const previousTitle = document.title;
      document.title = `${displayName} | Chatroom`;
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
              <span className="bg-chatroom-bg-tertiary px-2 md:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-secondary hidden sm:block">
                Team: {chatroom.teamName}
              </span>
            )}
            <span
              className={getStatusBadgeClasses(chatroom.status, isSetupMode, isTeamDisconnected)}
            >
              {isTeamDisconnected ? 'Disconnected' : isSetupMode ? 'Setting Up' : chatroom.status}
            </span>
            {/* Sidebar Toggle Button with Status Indicator */}
            {!isSetupMode && (
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
            )}
            {/* Actions Menu - only show when not completed */}
            {chatroom.status !== 'completed' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
                    title="Actions"
                  >
                    <MoreVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem onClick={handleMarkComplete}>
                    <CheckCircle size={14} className="mr-2" />
                    Mark Complete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
    isTeamDisconnected,
    onBack,
    sidebarVisible,
    aggregateStatus,
    toggleSidebar,
    setHeaderContent,
    clearHeaderContent,
    getStatusBadgeClasses,
    displayName,
    handleMarkComplete,
  ]);

  // Wait for all required data and hydration before rendering to prevent flickering
  if (
    chatroom === undefined ||
    participants === undefined ||
    readiness === undefined ||
    isSmallScreen === undefined
  ) {
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
    <AttachedTasksProvider>
      <PromptsProvider
        chatroomId={chatroomId}
        teamName={teamName}
        teamRoles={teamRoles}
        teamEntryPoint={teamEntryPoint}
      >
        <>
          <div className="chatroom-root flex flex-col h-full overflow-hidden bg-chatroom-bg-primary text-chatroom-text-primary font-sans">
            {isSetupMode ? (
              <div className="setup-content flex flex-col h-full overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  <SetupChecklist
                    chatroomId={chatroomId}
                    teamName={teamName}
                    teamRoles={teamRoles}
                    teamEntryPoint={teamEntryPoint}
                    participants={participants || []}
                    onViewPrompt={handleViewPrompt}
                  />
                </div>
                {/* Backlog access during setup - collapsible at bottom */}
                <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface">
                  <TaskQueue chatroomId={chatroomId} />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 overflow-hidden relative">
                {/* Message Section */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <MessageFeed chatroomId={chatroomId} participants={participants || []} />
                  <SendForm chatroomId={chatroomId} />
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
                flex flex-col bg-chatroom-bg-surface backdrop-blur-xl border-l-2 border-chatroom-border-strong
                transition-all duration-300 ease-in-out
                ${isSmallScreen ? (sidebarVisible ? 'translate-x-0' : 'translate-x-full') : ''}
              `}
                >
                  <AgentPanel
                    chatroomId={chatroomId}
                    teamName={teamName}
                    teamRoles={teamRoles}
                    teamEntryPoint={teamEntryPoint}
                    readiness={readiness}
                    onViewPrompt={handleViewPrompt}
                    onReconnect={handleOpenReconnect}
                  />
                  <TaskQueue chatroomId={chatroomId} />
                  <div className="p-4 mt-auto border-t-2 border-chatroom-border-strong">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-1">
                      Chatroom ID
                    </div>
                    <div className="font-mono text-[10px] font-bold text-chatroom-text-secondary break-all p-2 bg-chatroom-bg-tertiary">
                      {chatroomId}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <PromptModal
            isOpen={modalState.isOpen}
            onClose={handleCloseModal}
            role={modalState.role}
          />

          <ReconnectModal
            isOpen={reconnectModalOpen}
            onClose={handleCloseReconnect}
            chatroomId={chatroomId}
            teamName={teamName}
            teamRoles={teamRoles}
            teamEntryPoint={teamEntryPoint}
            expiredRoles={readiness?.expiredRoles || []}
            participants={readiness?.participants}
            onViewPrompt={handleViewPrompt}
          />
        </>
      </PromptsProvider>
    </AttachedTasksProvider>
  );
}

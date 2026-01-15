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
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';

import { AgentPanel } from './components/AgentPanel';
import { MessageFeed } from './components/MessageFeed';
import { PromptModal } from './components/PromptModal';
import { ReconnectModal } from './components/ReconnectModal';
import { SendForm } from './components/SendForm';
import { SetupChecklist } from './components/SetupChecklist';
import { TeamStatus } from './components/TeamStatus';
import { generateAgentPrompt } from './prompts/generator';

import { useSetHeaderPortal } from '@/modules/header/HeaderPortalProvider';

interface ChatroomDashboardProps {
  chatroomId: string;
  onBack?: () => void;
}

interface ModalState {
  isOpen: boolean;
  role: string;
  prompt: string;
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
function useIsSmallScreen() {
  const [isSmall, setIsSmall] = useState(false);

  useEffect(() => {
    // Check initial screen size
    const checkSize = () => setIsSmall(window.innerWidth < 768);
    checkSize();

    // Listen for resize events
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  return isSmall;
}

export function ChatroomDashboard({ chatroomId, onBack }: ChatroomDashboardProps) {
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    role: '',
    prompt: '',
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

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((prev) => !prev);
  }, []);

  // Header portal integration
  const { setContent: setHeaderContent, clearContent: clearHeaderContent } = useSetHeaderPortal();

  // Rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isRenamePending, setIsRenamePending] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const chatroom = useSessionQuery(chatroomApi.chatrooms.get, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Chatroom | null | undefined;

  // Rename mutation
  const renameChatroom = useSessionMutation(chatroomApi.chatrooms.rename);

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
  const aggregateStatus = useMemo(() => {
    if (!participants || participants.length === 0) return 'none';
    const nonUserParticipants = participants.filter((p) => p.role.toLowerCase() !== 'user');
    if (nonUserParticipants.length === 0) return 'none';
    const hasActiveAgent = nonUserParticipants.some((p) => p.status === 'active');
    if (hasActiveAgent) return 'working';
    const allReady = nonUserParticipants.every(
      (p) => p.status === 'waiting' || p.status === 'active'
    );
    if (allReady) return 'ready';
    return 'partial';
  }, [participants]);

  // Memoize the team entry point
  const teamEntryPoint = useMemo(
    () => chatroom?.teamEntryPoint || teamRoles[0] || 'builder',
    [chatroom?.teamEntryPoint, teamRoles]
  );

  // Memoize callbacks to prevent unnecessary child re-renders
  const handleViewPrompt = useCallback(
    (role: string) => {
      const prompt = generateAgentPrompt({
        chatroomId,
        role,
        teamName,
        teamRoles,
        teamEntryPoint,
      });
      setModalState({
        isOpen: true,
        role,
        prompt,
      });
    },
    [chatroomId, teamName, teamRoles, teamEntryPoint]
  );

  const handleCloseModal = useCallback(() => {
    setModalState({
      isOpen: false,
      role: '',
      prompt: '',
    });
  }, []);

  // Reconnect modal handlers
  const handleOpenReconnect = useCallback(() => {
    setReconnectModalOpen(true);
  }, []);

  const handleCloseReconnect = useCallback(() => {
    setReconnectModalOpen(false);
  }, []);

  // Rename handlers
  const handleStartRename = useCallback(() => {
    setEditedName(chatroom?.name || chatroom?.teamName || '');
    setIsEditingName(true);
    // Focus input after render
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [chatroom?.name, chatroom?.teamName]);

  const handleCancelRename = useCallback(() => {
    setIsEditingName(false);
    setEditedName('');
  }, []);

  const handleSaveRename = useCallback(async () => {
    if (!editedName.trim()) {
      handleCancelRename();
      return;
    }
    setIsRenamePending(true);
    try {
      await renameChatroom({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        name: editedName.trim(),
      });
      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to rename chatroom:', error);
    } finally {
      setIsRenamePending(false);
    }
  }, [editedName, renameChatroom, chatroomId, handleCancelRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSaveRename();
      } else if (e.key === 'Escape') {
        handleCancelRename();
      }
    },
    [handleSaveRename, handleCancelRename]
  );

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

  // Status badge colors
  const getStatusBadgeClasses = useCallback(
    (status: string, isSetup: boolean, isDisconnected: boolean) => {
      const base = 'px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide';
      if (isDisconnected) return `${base} bg-red-400/15 text-red-400`;
      if (isSetup) return `${base} bg-amber-400/15 text-amber-400`;
      switch (status) {
        case 'active':
          return `${base} bg-emerald-400/15 text-emerald-400`;
        case 'completed':
          return `${base} bg-blue-400/15 text-blue-400`;
        default:
          return `${base} bg-zinc-500/15 text-zinc-500`;
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
                className="bg-transparent border-2 border-zinc-700 text-zinc-400 w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-zinc-800 hover:border-zinc-600 hover:text-zinc-100"
                onClick={onBack}
                title="Back to chatroom list"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            {/* Chatroom Name - Editable */}
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  className="bg-zinc-800 border-2 border-zinc-600 text-zinc-100 px-2 py-1 text-xs font-bold uppercase tracking-wide w-32 sm:w-48 focus:outline-none focus:border-zinc-500"
                  placeholder="Enter name..."
                  disabled={isRenamePending}
                  maxLength={100}
                />
                <button
                  className="bg-transparent border-2 border-zinc-700 text-emerald-400 w-6 h-6 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-zinc-800 hover:border-emerald-600 disabled:opacity-50"
                  onClick={handleSaveRename}
                  disabled={isRenamePending}
                  title="Save name"
                >
                  <Check size={12} />
                </button>
                <button
                  className="bg-transparent border-2 border-zinc-700 text-zinc-400 w-6 h-6 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-zinc-800 hover:border-zinc-600 hover:text-zinc-100"
                  onClick={handleCancelRename}
                  disabled={isRenamePending}
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-zinc-100 text-xs font-bold uppercase tracking-wide hidden sm:block max-w-[200px] truncate">
                  {displayName}
                </span>
                <button
                  className="bg-transparent border-0 text-zinc-500 w-5 h-5 flex items-center justify-center cursor-pointer transition-all duration-100 hover:text-zinc-300"
                  onClick={handleStartRename}
                  title="Rename chatroom"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>
        ),
        right: (
          <div className="flex gap-2 md:gap-3 items-center">
            {chatroom.teamName && (
              <span className="bg-zinc-800 px-2 md:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400 hidden sm:block">
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
                className="bg-transparent border-2 border-zinc-700 text-zinc-400 w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-zinc-800 hover:border-zinc-600 hover:text-zinc-100 relative"
                onClick={toggleSidebar}
                title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              >
                {sidebarVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                {/* Aggregate status indicator - shown when sidebar is hidden */}
                {!sidebarVisible && aggregateStatus !== 'none' && (
                  <span
                    className={`absolute -top-1 -right-1 w-2.5 h-2.5 ${
                      aggregateStatus === 'working'
                        ? 'bg-blue-400'
                        : aggregateStatus === 'ready'
                          ? 'bg-emerald-400'
                          : 'bg-zinc-500'
                    }`}
                  />
                )}
              </button>
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
    isSetupMode,
    isTeamDisconnected,
    onBack,
    sidebarVisible,
    aggregateStatus,
    toggleSidebar,
    setHeaderContent,
    clearHeaderContent,
    getStatusBadgeClasses,
    isEditingName,
    editedName,
    isRenamePending,
    displayName,
    handleStartRename,
    handleCancelRename,
    handleSaveRename,
    handleRenameKeyDown,
  ]);

  if (chatroom === undefined || participants === undefined) {
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
    <>
      <div className="chatroom-root flex flex-col h-full overflow-hidden bg-chatroom-bg-primary text-chatroom-text-primary font-sans">
        {isSetupMode ? (
          <div className="setup-content">
            <SetupChecklist
              chatroomId={chatroomId}
              teamName={teamName}
              teamRoles={teamRoles}
              teamEntryPoint={teamEntryPoint}
              participants={participants || []}
              onViewPrompt={handleViewPrompt}
            />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden relative">
            {/* Message Section */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <MessageFeed chatroomId={chatroomId} participants={participants || []} />
              <SendForm chatroomId={chatroomId} readiness={readiness} />
            </div>

            {/* Sidebar Overlay for mobile - below app header */}
            {sidebarVisible && isSmallScreen && (
              <div
                className="fixed inset-0 top-14 bg-black/50 z-30 md:hidden"
                onClick={toggleSidebar}
              />
            )}

            {/* Sidebar - positioned below app header on mobile */}
            <div
              className={`
                ${isSmallScreen ? 'fixed right-0 top-14 bottom-0 z-40' : 'relative'}
                w-80 flex flex-col bg-chatroom-bg-surface backdrop-blur-xl border-l-2 border-chatroom-border-strong
                transition-transform duration-300 ease-in-out
                ${sidebarVisible ? 'translate-x-0' : 'translate-x-full'}
              `}
            >
              <AgentPanel
                chatroomId={chatroomId}
                teamName={teamName}
                teamRoles={teamRoles}
                teamEntryPoint={teamEntryPoint}
                participants={participants || []}
                onViewPrompt={handleViewPrompt}
              />
              <TeamStatus readiness={readiness} onReconnect={handleOpenReconnect} />
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
        prompt={modalState.prompt}
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
  );
}

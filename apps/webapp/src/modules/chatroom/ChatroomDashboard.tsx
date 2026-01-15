'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { ArrowLeft, XCircle, PanelRightOpen, PanelRightClose } from 'lucide-react';
import React, { useState, useMemo, useCallback, useEffect } from 'react';

import { AgentPanel } from './components/AgentPanel';
import { MessageFeed } from './components/MessageFeed';
import { PromptModal } from './components/PromptModal';
import { SendForm } from './components/SendForm';
import { SetupChecklist } from './components/SetupChecklist';
import { TeamStatus } from './components/TeamStatus';
import { generateAgentPrompt } from './prompts/generator';

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

interface TeamReadiness {
  isReady: boolean;
  teamName: string;
  expectedRoles: string[];
  missingRoles: string[];
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

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const chatroom = useSessionQuery(chatroomApi.chatrooms.get, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Chatroom | null | undefined;

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

  // Memoize callbacks to prevent unnecessary child re-renders
  const handleViewPrompt = useCallback(
    (role: string) => {
      const prompt = generateAgentPrompt({
        chatroomId,
        role,
        teamName,
        teamRoles,
      });
      setModalState({
        isOpen: true,
        role,
        prompt,
      });
    },
    [chatroomId, teamName, teamRoles]
  );

  const handleCloseModal = useCallback(() => {
    setModalState({
      isOpen: false,
      role: '',
      prompt: '',
    });
  }, []);

  if (chatroom === undefined || participants === undefined) {
    return (
      <div className="chatroom-root flex items-center justify-center h-screen bg-chatroom-bg-primary text-chatroom-text-muted">
        <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
      </div>
    );
  }

  if (chatroom === null) {
    return (
      <div className="chatroom-root flex flex-col items-center justify-center h-screen bg-chatroom-bg-primary text-chatroom-status-error">
        <div className="text-5xl mb-4">
          <XCircle size={48} />
        </div>
        <div>Chatroom not found</div>
        <div className="mt-2 text-chatroom-text-muted">ID: {chatroomId}</div>
      </div>
    );
  }

  // Show setup checklist if not all members have joined
  const isSetupMode = !allMembersJoined;

  // Status badge colors
  const getStatusBadgeClasses = (status: string, isSetup: boolean) => {
    const base = 'px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide';
    if (isSetup) return `${base} bg-amber-400/15 text-chatroom-status-warning`;
    switch (status) {
      case 'active':
        return `${base} bg-emerald-400/15 text-chatroom-status-success`;
      case 'completed':
        return `${base} bg-blue-400/15 text-chatroom-status-info`;
      default:
        return `${base} bg-zinc-500/15 text-chatroom-text-muted`;
    }
  };

  return (
    <>
      <div className="chatroom-root flex flex-col h-screen overflow-hidden bg-chatroom-bg-primary text-chatroom-text-primary font-sans">
        {/* Header */}
        <header className="flex justify-between items-center px-4 md:px-6 py-4 bg-chatroom-bg-surface backdrop-blur-xl border-b-2 border-chatroom-border-strong">
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
            <h1 className="text-sm font-bold uppercase tracking-widest hidden sm:block">
              Chatroom Dashboard
            </h1>
            <h1 className="text-sm font-bold uppercase tracking-widest sm:hidden">Dashboard</h1>
          </div>
          <div className="flex gap-2 md:gap-4 items-center">
            {chatroom.teamName && (
              <span className="bg-chatroom-bg-tertiary px-2 md:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-secondary hidden sm:block">
                Team: {chatroom.teamName}
              </span>
            )}
            <span className={getStatusBadgeClasses(chatroom.status, isSetupMode)}>
              {isSetupMode ? 'Setting Up' : chatroom.status}
            </span>
            {/* Sidebar Toggle Button */}
            {!isSetupMode && (
              <button
                className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
                onClick={toggleSidebar}
                title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              >
                {sidebarVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
          </div>
        </header>

        {isSetupMode ? (
          <div className="setup-content">
            <SetupChecklist
              chatroomId={chatroomId}
              teamName={teamName}
              teamRoles={teamRoles}
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

            {/* Sidebar Overlay for mobile */}
            {sidebarVisible && isSmallScreen && (
              <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={toggleSidebar} />
            )}

            {/* Sidebar */}
            <div
              className={`
                ${isSmallScreen ? 'fixed right-0 top-0 h-full z-40' : 'relative'}
                w-80 flex flex-col bg-chatroom-bg-surface backdrop-blur-xl border-l-2 border-chatroom-border-strong
                transition-transform duration-300 ease-in-out
                ${sidebarVisible ? 'translate-x-0' : 'translate-x-full'}
              `}
            >
              {/* Close button for mobile */}
              {isSmallScreen && (
                <button
                  className="absolute top-4 right-4 bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary z-10"
                  onClick={toggleSidebar}
                  title="Close sidebar"
                >
                  <XCircle size={16} />
                </button>
              )}
              <AgentPanel
                chatroomId={chatroomId}
                teamName={teamName}
                teamRoles={teamRoles}
                participants={participants || []}
                onViewPrompt={handleViewPrompt}
              />
              <TeamStatus readiness={readiness} />
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
    </>
  );
}

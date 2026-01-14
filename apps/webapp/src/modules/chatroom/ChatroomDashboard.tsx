'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { ArrowLeft, XCircle } from 'lucide-react';
import React, { useState, useMemo, useCallback } from 'react';

import { AgentPanel } from './components/AgentPanel';
import { MessageFeed } from './components/MessageFeed';
import { PromptModal } from './components/PromptModal';
import { SendForm } from './components/SendForm';
import { SetupChecklist } from './components/SetupChecklist';
import { TeamStatus } from './components/TeamStatus';
import { generateAgentPrompt } from './prompts/generator';
import './styles/index.css';

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

export function ChatroomDashboard({ chatroomId, onBack }: ChatroomDashboardProps) {
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    role: '',
    prompt: '',
  });

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
      <div className="chatroom-root loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (chatroom === null) {
    return (
      <div className="chatroom-root error">
        <div className="error-icon">
          <XCircle size={24} />
        </div>
        <div>Chatroom not found</div>
        <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>ID: {chatroomId}</div>
      </div>
    );
  }

  // Show setup checklist if not all members have joined
  const isSetupMode = !allMembersJoined;

  return (
    <>
      <div className="chatroom-root dashboard">
        <header className="header">
          <div className="header-left">
            {onBack && (
              <button className="back-button" onClick={onBack} title="Back to chatroom list">
                <ArrowLeft size={16} />
              </button>
            )}
            <h1>Chatroom Dashboard</h1>
          </div>
          <div className="header-info">
            {chatroom.teamName && <span className="team-badge">Team: {chatroom.teamName}</span>}
            <span className={`team-badge status-badge ${isSetupMode ? 'setup' : chatroom.status}`}>
              {isSetupMode ? 'Setting Up' : chatroom.status}
            </span>
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
          <div className="main-content">
            <div className="message-section">
              <MessageFeed chatroomId={chatroomId} participants={participants || []} />
              <SendForm chatroomId={chatroomId} readiness={readiness} />
            </div>

            <div className="sidebar">
              <AgentPanel
                chatroomId={chatroomId}
                teamName={teamName}
                teamRoles={teamRoles}
                participants={participants || []}
                onViewPrompt={handleViewPrompt}
              />
              <TeamStatus readiness={readiness} />
              <div className="chatroom-id">
                <div className="chatroom-id-label">Chatroom ID</div>
                <div className="chatroom-id-value">{chatroomId}</div>
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

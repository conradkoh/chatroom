'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { MessageSquare } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo } from 'react';

import { CreateChatroomForm } from './CreateChatroomForm';

type TabType = 'current' | 'complete';

interface ChatroomSelectorProps {
  onSelect: (chatroomId: string) => void;
}

interface Chatroom {
  _id: string;
  _creationTime: number;
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

interface Message {
  _id: string;
  _creationTime: number;
  chatroomId: string;
  senderRole: string;
  content: string;
  type: string;
}

export function ChatroomSelector({ onSelect }: ChatroomSelectorProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('current');

  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  // Query all chatrooms owned by the user - we'll filter by status on the client
  const chatrooms = useSessionQuery(chatroomApi.chatrooms.listByUser) as Chatroom[] | undefined;

  const handleCreated = useCallback(
    (chatroomId: string) => {
      setShowCreateForm(false);
      onSelect(chatroomId);
    },
    [onSelect]
  );

  if (chatrooms === undefined) {
    return (
      <div className="chatroom-root chatroom-selector">
        <div className="selector-loading">
          <div className="loading-spinner" />
          <span>Loading chatrooms...</span>
        </div>
      </div>
    );
  }

  if (showCreateForm) {
    return (
      <div className="chatroom-root chatroom-selector">
        <CreateChatroomForm onCreated={handleCreated} onCancel={() => setShowCreateForm(false)} />
      </div>
    );
  }

  if (chatrooms.length === 0) {
    return (
      <div className="chatroom-root chatroom-selector">
        <div className="selector-header">
          <h1>Welcome</h1>
          <p>Create your first chatroom to get started</p>
        </div>
        <div className="selector-empty">
          <span className="empty-icon">
            <MessageSquare size={32} />
          </span>
          <button className="new-chatroom-button-large" onClick={() => setShowCreateForm(true)}>
            Create New Chatroom
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chatroom-root chatroom-selector">
      <div className="selector-header">
        <div className="selector-header-content">
          <h1>Chatrooms</h1>
          <p>Select a chatroom or create a new one</p>
        </div>
        <button className="new-chatroom-button" onClick={() => setShowCreateForm(true)}>
          + New
        </button>
      </div>
      <div className="chatroom-tabs">
        <button
          className={`tab-button ${activeTab === 'current' ? 'active' : ''}`}
          onClick={() => setActiveTab('current')}
        >
          Current
        </button>
        <button
          className={`tab-button ${activeTab === 'complete' ? 'active' : ''}`}
          onClick={() => setActiveTab('complete')}
        >
          Complete
        </button>
      </div>
      <div className="chatroom-list">
        {chatrooms.map((chatroom) => (
          <ChatroomCard
            key={chatroom._id}
            chatroom={chatroom}
            onSelect={onSelect}
            activeTab={activeTab}
          />
        ))}
      </div>
    </div>
  );
}

interface ChatroomCardProps {
  chatroom: Chatroom;
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}

const ChatroomCard = memo(function ChatroomCard({
  chatroom,
  onSelect,
  activeTab,
}: ChatroomCardProps) {
  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const participants = useSessionQuery(chatroomApi.participants.list, {
    chatroomId: chatroom._id as Id<'chatrooms'>,
  }) as Participant[] | undefined;

  // Only fetch last message for activity timestamp
  const messages = useSessionQuery(chatroomApi.messages.list, {
    chatroomId: chatroom._id as Id<'chatrooms'>,
  }) as Message[] | undefined;

  // Check if data is still loading
  const isLoading = participants === undefined;

  // Create a map of role -> status for quick lookup
  const participantStatus = useMemo(
    () => new Map((participants || []).map((p) => [p.role.toLowerCase(), p.status])),
    [participants]
  );

  // Get the latest activity time (most recent message or creation time)
  const lastActivity = useMemo(() => {
    if (messages && messages.length > 0) {
      return messages[messages.length - 1]!._creationTime;
    }
    return chatroom._creationTime;
  }, [messages, chatroom._creationTime]);

  const formattedDate = useMemo(() => {
    return new Date(lastActivity).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }, [lastActivity]);

  // Compute effective status based on participants
  const storedStatus = chatroom.status;
  const hasConnectedAgents = useMemo(
    () => participants?.some((p) => p.status === 'waiting' || p.status === 'active'),
    [participants]
  );

  const status = isLoading
    ? 'loading'
    : storedStatus === 'completed'
      ? 'completed'
      : hasConnectedAgents
        ? 'active'
        : 'idle';

  // Filter based on active tab
  const shouldShow = activeTab === 'current' ? status !== 'completed' : status === 'completed';

  if (!shouldShow) {
    return null;
  }

  const teamRoles = chatroom.teamRoles || [];
  const teamName = chatroom.teamName || 'Team';

  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className="chatroom-card chatroom-card-skeleton">
        <div className="card-main">
          <div className="card-header">
            <span className="card-team">{teamName}</span>
            <span className="card-status loading">
              <span className="skeleton-text">loading</span>
            </span>
          </div>
          <div className="card-id">{chatroom._id}</div>
        </div>
        <div className="card-agents">
          {teamRoles.map((role) => (
            <div key={role} className="card-agent">
              <span className="card-agent-indicator skeleton" />
              <span className="card-agent-role">{role}</span>
            </div>
          ))}
        </div>
        <div className="card-date skeleton-text">{formattedDate}</div>
      </div>
    );
  }

  return (
    <button
      className="chatroom-card"
      onClick={() => onSelect(chatroom._id)}
      data-last-activity={lastActivity}
    >
      <div className="card-main">
        <div className="card-header">
          <span className="card-team">{teamName}</span>
          <span className={`card-status ${status}`}>{status}</span>
        </div>
        <div className="card-id">{chatroom._id}</div>
      </div>
      <div className="card-agents">
        {teamRoles.map((role) => {
          const agentStatus = participantStatus.get(role.toLowerCase());
          const isConnected = agentStatus === 'waiting' || agentStatus === 'active';
          const isActive = agentStatus === 'active';
          return (
            <div key={role} className="card-agent">
              <span
                className={`card-agent-indicator ${
                  isConnected ? (isActive ? 'active' : 'connected') : 'offline'
                }`}
              />
              <span className="card-agent-role">{role}</span>
            </div>
          );
        })}
      </div>
      <div className="card-date">{formattedDate}</div>
    </button>
  );
});

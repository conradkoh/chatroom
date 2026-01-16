'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { MessageSquare, MoreVertical, CheckCircle } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo } from 'react';

import { CreateChatroomForm } from './CreateChatroomForm';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type TabType = 'current' | 'complete';

interface ChatroomSelectorProps {
  onSelect: (chatroomId: string) => void;
}

interface Chatroom {
  _id: string;
  _creationTime: number;
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

interface Message {
  _id: string;
  _creationTime: number;
  chatroomId: string;
  senderRole: string;
  content: string;
  type: string;
}

// Status badge colors
const getStatusBadgeClasses = (status: string) => {
  const base = 'px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide';
  switch (status) {
    case 'active':
      return `${base} bg-emerald-400/15 text-chatroom-status-success`;
    case 'completed':
      return `${base} bg-blue-400/15 text-chatroom-status-info`;
    case 'loading':
      return `${base} bg-zinc-500/15 text-chatroom-text-muted`;
    default:
      return `${base} bg-zinc-500/15 text-chatroom-text-muted`;
  }
};

// Agent status indicator
const getAgentIndicatorClasses = (status: 'active' | 'connected' | 'offline' | 'skeleton') => {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  switch (status) {
    case 'active':
      return `${base} bg-chatroom-status-info`;
    case 'connected':
      return `${base} bg-chatroom-status-success`;
    case 'skeleton':
      return `${base} bg-chatroom-text-muted animate-pulse`;
    default:
      return `${base} bg-chatroom-text-muted`;
  }
};

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
      <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
          <span className="text-chatroom-text-muted text-sm">Loading chatrooms...</span>
        </div>
      </div>
    );
  }

  if (showCreateForm) {
    return (
      <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6 flex items-start justify-center pt-20">
        <CreateChatroomForm onCreated={handleCreated} onCancel={() => setShowCreateForm(false)} />
      </div>
    );
  }

  if (chatrooms.length === 0) {
    return (
      <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
        {/* Header */}
        <div className="mb-8 border-b-2 border-chatroom-border pb-6">
          <h1 className="text-lg font-bold uppercase tracking-widest mb-2">Welcome</h1>
          <p className="text-chatroom-text-muted text-sm">
            Create your first chatroom to get started
          </p>
        </div>
        {/* Empty State */}
        <div className="flex flex-col items-center justify-center py-16 text-chatroom-text-muted">
          <span className="text-5xl mb-6">
            <MessageSquare size={48} />
          </span>
          <button
            className="bg-chatroom-accent text-chatroom-bg-primary px-6 py-3 font-bold text-sm uppercase tracking-widest cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary"
            onClick={() => setShowCreateForm(true)}
          >
            Create New Chatroom
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-6 border-b-2 border-chatroom-border pb-6">
        <div>
          <h1 className="text-lg font-bold uppercase tracking-widest mb-2">Chatrooms</h1>
          <p className="text-chatroom-text-muted text-sm">Select a chatroom or create a new one</p>
        </div>
        <button
          className="bg-chatroom-accent text-chatroom-bg-primary px-4 py-2 font-bold text-xs uppercase tracking-wide cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary"
          onClick={() => setShowCreateForm(true)}
        >
          + New
        </button>
      </div>
      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b-2 border-chatroom-border">
        <button
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all duration-100 border-b-2 -mb-0.5 ${
            activeTab === 'current'
              ? 'text-chatroom-accent border-chatroom-accent'
              : 'text-chatroom-text-muted border-transparent hover:text-chatroom-text-secondary'
          }`}
          onClick={() => setActiveTab('current')}
        >
          Current
        </button>
        <button
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all duration-100 border-b-2 -mb-0.5 ${
            activeTab === 'complete'
              ? 'text-chatroom-accent border-chatroom-accent'
              : 'text-chatroom-text-muted border-transparent hover:text-chatroom-text-secondary'
          }`}
          onClick={() => setActiveTab('complete')}
        >
          Complete
        </button>
      </div>
      {/* Chatroom List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
    chatroomId: chatroom._id as Id<'chatroom_rooms'>,
  }) as Participant[] | undefined;

  // Only fetch last message for activity timestamp
  const messages = useSessionQuery(chatroomApi.messages.list, {
    chatroomId: chatroom._id as Id<'chatroom_rooms'>,
  }) as Message[] | undefined;

  // Mutation to mark chatroom as complete
  const updateStatus = useSessionMutation(chatroomApi.chatrooms.updateStatus);

  const handleMarkComplete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      try {
        await updateStatus({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
          status: 'completed',
        });
      } catch (error) {
        console.error('Failed to mark as complete:', error);
      }
    },
    [updateStatus, chatroom._id]
  );

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
  // Use custom name if set, otherwise show team name
  const displayName = chatroom.name || teamName;

  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className="bg-chatroom-bg-surface border-2 border-chatroom-border p-4 cursor-default">
        {/* Card Main */}
        <div className="flex justify-between items-start mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary">
            {displayName}
          </span>
          <span className={getStatusBadgeClasses('loading')}>
            <span className="animate-pulse">loading</span>
          </span>
        </div>
        <div className="font-mono text-[10px] text-chatroom-text-muted truncate mb-3">
          {chatroom._id}
        </div>
        {/* Card Agents */}
        <div className="flex flex-wrap gap-2 mb-3">
          {teamRoles.map((role) => (
            <div key={role} className="flex items-center gap-1.5">
              <span className={getAgentIndicatorClasses('skeleton')} />
              <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                {role}
              </span>
            </div>
          ))}
        </div>
        {/* Card Date */}
        <div className="text-[10px] text-chatroom-text-muted animate-pulse">{formattedDate}</div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        className="bg-chatroom-bg-surface border-2 border-chatroom-border p-4 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer w-full"
        onClick={() => onSelect(chatroom._id)}
        data-last-activity={lastActivity}
      >
        {/* Card Main */}
        <div className="flex justify-between items-start mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary pr-6">
            {displayName}
          </span>
          <span className={getStatusBadgeClasses(status)}>{status}</span>
        </div>
        <div className="font-mono text-[10px] text-chatroom-text-muted truncate mb-3">
          {chatroom._id}
        </div>
        {/* Card Agents */}
        <div className="flex flex-wrap gap-2 mb-3">
          {teamRoles.map((role) => {
            const agentStatus = participantStatus.get(role.toLowerCase());
            const isConnected = agentStatus === 'waiting' || agentStatus === 'active';
            const isActive = agentStatus === 'active';
            return (
              <div key={role} className="flex items-center gap-1.5">
                <span
                  className={getAgentIndicatorClasses(
                    isConnected ? (isActive ? 'active' : 'connected') : 'offline'
                  )}
                />
                <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                  {role}
                </span>
              </div>
            );
          })}
        </div>
        {/* Card Date */}
        <div className="text-[10px] text-chatroom-text-muted">{formattedDate}</div>
      </button>

      {/* Action Menu - only show for non-completed chatrooms */}
      {status !== 'completed' && (
        <div className="absolute top-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-7 h-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-all duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem onClick={handleMarkComplete}>
                <CheckCircle size={14} className="mr-2" />
                Mark Complete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
});

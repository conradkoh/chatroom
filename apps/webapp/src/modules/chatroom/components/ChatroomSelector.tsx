'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { MessageSquare, MoreVertical, CheckCircle } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo } from 'react';

import { CreateChatroomForm } from './CreateChatroomForm';
import { useChatroomListing, type ChatroomWithStatus } from '../context/ChatroomListingContext';

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

// Status badge colors - using chatroom status variables for theme support
const getStatusBadgeClasses = (chatStatus: ChatroomWithStatus['chatStatus']) => {
  const base = 'px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide';
  switch (chatStatus) {
    case 'ready':
      return `${base} bg-chatroom-status-success/15 text-chatroom-status-success`;
    case 'working':
      return `${base} bg-chatroom-status-info/15 text-chatroom-status-info`;
    case 'completed':
      return `${base} bg-chatroom-status-info/15 text-chatroom-status-info`;
    case 'disconnected':
      return `${base} bg-chatroom-status-error/15 text-chatroom-status-error`;
    case 'setup':
      return `${base} bg-chatroom-status-warning/15 text-chatroom-status-warning`;
    case 'partial':
    default:
      return `${base} bg-chatroom-text-muted/15 text-chatroom-text-muted`;
  }
};

// Agent status indicator - now uses effectiveStatus which accounts for expiration
const getAgentIndicatorClasses = (
  effectiveStatus: 'active' | 'waiting' | 'idle' | 'disconnected'
) => {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  switch (effectiveStatus) {
    case 'active':
      return `${base} bg-chatroom-status-info`;
    case 'waiting':
      return `${base} bg-chatroom-status-success`;
    case 'disconnected':
      return `${base} bg-chatroom-status-error`;
    case 'idle':
    default:
      return `${base} bg-chatroom-text-muted`;
  }
};

export function ChatroomSelector({ onSelect }: ChatroomSelectorProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('current');

  // Use context for chatroom data - single source of truth
  const { chatrooms, isLoading } = useChatroomListing();

  const handleCreated = useCallback(
    (chatroomId: string) => {
      setShowCreateForm(false);
      onSelect(chatroomId);
    },
    [onSelect]
  );

  if (isLoading) {
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

  if (!chatrooms || chatrooms.length === 0) {
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
  chatroom: ChatroomWithStatus;
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

  const formattedDate = useMemo(() => {
    return new Date(chatroom._creationTime).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }, [chatroom._creationTime]);

  // Use computed chatStatus from backend (single source of truth)
  const { chatStatus, agents } = chatroom;

  // Filter based on active tab using chatStatus
  const shouldShow =
    activeTab === 'current' ? chatStatus !== 'completed' : chatStatus === 'completed';

  if (!shouldShow) {
    return null;
  }

  const teamRoles = chatroom.teamRoles || [];
  const teamName = chatroom.teamName || 'Team';
  // Use custom name if set, otherwise show team name
  const displayName = chatroom.name || teamName;

  // Create a map of role -> agent for quick lookup
  const agentMap = new Map(agents.map((a) => [a.role.toLowerCase(), a]));

  // Display label for chat status
  const statusLabel =
    chatStatus === 'ready'
      ? 'ready'
      : chatStatus === 'working'
        ? 'working'
        : chatStatus === 'completed'
          ? 'completed'
          : chatStatus === 'disconnected'
            ? 'disconnected'
            : chatStatus === 'setup'
              ? 'setup'
              : 'idle';

  return (
    <div className="relative">
      <button
        className="bg-chatroom-bg-surface border-2 border-chatroom-border p-4 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer w-full"
        onClick={() => onSelect(chatroom._id)}
        data-chat-status={chatStatus}
      >
        {/* Card Main */}
        <div className="flex justify-between items-start mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary pr-2 flex-1 min-w-0 truncate">
            {displayName}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={getStatusBadgeClasses(chatStatus)}>{statusLabel}</span>
            {/* Action Menu - only show for non-completed chatrooms */}
            {chatStatus !== 'completed' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div
                    className="w-7 h-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-all duration-100"
                    onClick={(e) => e.stopPropagation()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                      }
                    }}
                  >
                    <MoreVertical size={14} />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[140px]">
                  <DropdownMenuItem onClick={handleMarkComplete}>
                    <CheckCircle size={14} className="mr-2" />
                    Mark Complete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="font-mono text-[10px] text-chatroom-text-muted truncate mb-3">
          {chatroom._id}
        </div>
        {/* Card Agents - now uses effectiveStatus which accounts for expiration */}
        <div className="flex flex-wrap gap-2 mb-3">
          {teamRoles.map((role) => {
            const agent = agentMap.get(role.toLowerCase());
            // Use effectiveStatus which is computed on backend and accounts for readyUntil expiration
            const effectiveStatus = agent?.effectiveStatus || 'idle';
            return (
              <div key={role} className="flex items-center gap-1.5">
                <span className={getAgentIndicatorClasses(effectiveStatus)} />
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
    </div>
  );
});

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { MessageSquare, MoreVertical, CheckCircle, LayoutGrid, List, Star } from 'lucide-react';
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
type ViewMode = 'grid' | 'table';

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
const getAgentIndicatorClasses = (effectiveStatus: 'active' | 'waiting' | 'disconnected') => {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  switch (effectiveStatus) {
    case 'active':
      return `${base} bg-chatroom-status-info`;
    case 'waiting':
      return `${base} bg-chatroom-status-success`;
    case 'disconnected':
      return `${base} bg-chatroom-status-error`;
    default:
      return `${base} bg-chatroom-text-muted`;
  }
};

export function ChatroomSelector({ onSelect }: ChatroomSelectorProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Use context for chatroom data - single source of truth
  const { chatrooms, isLoading } = useChatroomListing();

  const handleCreated = useCallback(
    (chatroomId: string) => {
      setShowCreateForm(false);
      onSelect(chatroomId);
    },
    [onSelect]
  );

  // Compute recently used chatrooms (top 3 by last activity, non-completed)
  const recentlyUsed = useMemo(() => {
    if (!chatrooms) return [];
    return chatrooms.filter((c) => c.chatStatus !== 'completed').slice(0, 3);
  }, [chatrooms]);

  // Compute favorite chatrooms
  const favorites = useMemo(() => {
    if (!chatrooms) return [];
    return chatrooms.filter((c) => c.isFavorite);
  }, [chatrooms]);

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

      {/* Recently Used Section - Desktop: 3 cards, Mobile: horizontally scrollable */}
      {recentlyUsed.length > 0 && activeTab === 'current' && (
        <div className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
            Recently Used
          </h2>
          {/* Desktop: grid of 3 */}
          <div className="hidden md:grid md:grid-cols-3 gap-4">
            {recentlyUsed.map((chatroom) => (
              <RecentChatroomCard key={chatroom._id} chatroom={chatroom} onSelect={onSelect} />
            ))}
          </div>
          {/* Mobile: horizontal scroll showing 1.5 cards */}
          <div className="md:hidden overflow-x-auto scrollbar-hide -mx-6 px-6">
            <div className="flex gap-4" style={{ width: 'max-content' }}>
              {recentlyUsed.map((chatroom) => (
                <div key={chatroom._id} className="w-[75vw] flex-shrink-0">
                  <RecentChatroomCard chatroom={chatroom} onSelect={onSelect} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Favorites Section */}
      {favorites.length > 0 && activeTab === 'current' && (
        <div className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3 flex items-center gap-2">
            <Star size={12} className="text-yellow-500" fill="currentColor" />
            Favorites
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {favorites.map((chatroom) => (
              <ChatroomCard
                key={chatroom._id}
                chatroom={chatroom}
                onSelect={onSelect}
                activeTab={activeTab}
                showInFavorites
              />
            ))}
          </div>
        </div>
      )}

      {/* Tabs and View Toggle */}
      <div className="flex justify-between items-center mb-6 border-b-2 border-chatroom-border">
        <div className="flex gap-0">
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
        {/* View Toggle */}
        <div className="flex gap-1 -mb-0.5 pb-2">
          <button
            className={`w-8 h-8 flex items-center justify-center transition-all duration-100 border-2 ${
              viewMode === 'grid'
                ? 'bg-chatroom-accent text-chatroom-bg-primary border-chatroom-accent'
                : 'bg-transparent text-chatroom-text-muted border-chatroom-border hover:text-chatroom-text-primary hover:border-chatroom-border-strong'
            }`}
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={`w-8 h-8 flex items-center justify-center transition-all duration-100 border-2 ${
              viewMode === 'table'
                ? 'bg-chatroom-accent text-chatroom-bg-primary border-chatroom-accent'
                : 'bg-transparent text-chatroom-text-muted border-chatroom-border hover:text-chatroom-text-primary hover:border-chatroom-border-strong'
            }`}
            onClick={() => setViewMode('table')}
            title="Table view"
          >
            <List size={14} />
          </button>
        </div>
      </div>
      {/* Chatroom List */}
      {viewMode === 'grid' ? (
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
      ) : (
        <ChatroomTable chatrooms={chatrooms} onSelect={onSelect} activeTab={activeTab} />
      )}
    </div>
  );
}

/**
 * Compact card for recently used chatrooms section
 */
interface RecentChatroomCardProps {
  chatroom: ChatroomWithStatus;
  onSelect: (chatroomId: string) => void;
}

const RecentChatroomCard = memo(function RecentChatroomCard({
  chatroom,
  onSelect,
}: RecentChatroomCardProps) {
  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  // Mutation to toggle favorite
  const toggleFavorite = useSessionMutation(chatroomApi.chatrooms.toggleFavorite);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      try {
        await toggleFavorite({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
      }
    },
    [toggleFavorite, chatroom._id]
  );

  const teamName = chatroom.teamName || 'Team';
  const displayName = chatroom.name || teamName;
  const { chatStatus } = chatroom;

  const statusLabel =
    chatStatus === 'ready'
      ? 'ready'
      : chatStatus === 'working'
        ? 'working'
        : chatStatus === 'setup'
          ? 'setup'
          : chatStatus === 'disconnected'
            ? 'disconnected'
            : 'partial';

  return (
    <button
      className="bg-chatroom-bg-surface border-2 border-chatroom-border p-3 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer w-full"
      onClick={() => onSelect(chatroom._id)}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary truncate flex-1 mr-2">
          {displayName}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleToggleFavorite}
            className={`w-6 h-6 flex items-center justify-center transition-all duration-100 ${
              chatroom.isFavorite
                ? 'text-yellow-500 hover:text-yellow-400'
                : 'text-chatroom-text-muted hover:text-yellow-500'
            }`}
            title={chatroom.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={12} fill={chatroom.isFavorite ? 'currentColor' : 'none'} />
          </button>
          <span className={getStatusBadgeClasses(chatStatus)}>{statusLabel}</span>
        </div>
      </div>
      <div className="font-mono text-[9px] text-chatroom-text-muted truncate">{chatroom._id}</div>
    </button>
  );
});

interface ChatroomCardProps {
  chatroom: ChatroomWithStatus;
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
  showInFavorites?: boolean;
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
  // Mutation to toggle favorite
  const toggleFavorite = useSessionMutation(chatroomApi.chatrooms.toggleFavorite);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      try {
        await toggleFavorite({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
      }
    },
    [toggleFavorite, chatroom._id]
  );

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
              : 'partial';

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
            {/* Favorite Star Button */}
            <button
              onClick={handleToggleFavorite}
              className={`w-7 h-7 flex items-center justify-center transition-all duration-100 ${
                chatroom.isFavorite
                  ? 'text-yellow-500 hover:text-yellow-400'
                  : 'text-chatroom-text-muted hover:text-yellow-500'
              }`}
              title={chatroom.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star size={14} fill={chatroom.isFavorite ? 'currentColor' : 'none'} />
            </button>
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
            const effectiveStatus = agent?.effectiveStatus || 'disconnected';
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

/**
 * Table view for chatrooms - more compact, data-dense display
 */
interface ChatroomTableProps {
  chatrooms: ChatroomWithStatus[];
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}

const ChatroomTable = memo(function ChatroomTable({
  chatrooms,
  onSelect,
  activeTab,
}: ChatroomTableProps) {
  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  // Mutation to mark chatroom as complete
  const updateStatus = useSessionMutation(chatroomApi.chatrooms.updateStatus);
  // Mutation to toggle favorite
  const toggleFavorite = useSessionMutation(chatroomApi.chatrooms.toggleFavorite);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent, chatroomId: string) => {
      e.stopPropagation();
      try {
        await toggleFavorite({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
      }
    },
    [toggleFavorite]
  );

  const handleMarkComplete = useCallback(
    async (e: React.MouseEvent, chatroomId: string) => {
      e.stopPropagation();
      try {
        await updateStatus({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          status: 'completed',
        });
      } catch (error) {
        console.error('Failed to mark as complete:', error);
      }
    },
    [updateStatus]
  );

  // Filter chatrooms based on active tab
  const filteredChatrooms = useMemo(() => {
    return chatrooms.filter((chatroom) => {
      const shouldShow =
        activeTab === 'current'
          ? chatroom.chatStatus !== 'completed'
          : chatroom.chatStatus === 'completed';
      return shouldShow;
    });
  }, [chatrooms, activeTab]);

  if (filteredChatrooms.length === 0) {
    return (
      <div className="text-center py-12 text-chatroom-text-muted">
        No chatrooms found in this tab
      </div>
    );
  }

  return (
    <div className="border-2 border-chatroom-border overflow-hidden">
      {/* Table Header */}
      <div className="grid grid-cols-[32px_1fr_100px_auto_100px_40px] gap-4 px-4 py-2 bg-chatroom-bg-tertiary border-b-2 border-chatroom-border">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Name
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Status
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Agents
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted text-right">
          Created
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted" />
      </div>
      {/* Table Rows */}
      {filteredChatrooms.map((chatroom) => {
        const teamRoles = chatroom.teamRoles || [];
        const teamName = chatroom.teamName || 'Team';
        const displayName = chatroom.name || teamName;
        const agentMap = new Map(chatroom.agents.map((a) => [a.role.toLowerCase(), a]));

        const statusLabel =
          chatroom.chatStatus === 'ready'
            ? 'ready'
            : chatroom.chatStatus === 'working'
              ? 'working'
              : chatroom.chatStatus === 'completed'
                ? 'completed'
                : chatroom.chatStatus === 'disconnected'
                  ? 'disconnected'
                  : chatroom.chatStatus === 'setup'
                    ? 'setup'
                    : 'partial';

        const formattedDate = new Date(chatroom._creationTime).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        return (
          <button
            key={chatroom._id}
            className="grid grid-cols-[32px_1fr_100px_auto_100px_40px] gap-4 px-4 py-3 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-all duration-100 text-left w-full"
            onClick={() => onSelect(chatroom._id)}
          >
            {/* Favorite Star */}
            <div
              className="flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
              role="button"
              tabIndex={-1}
            >
              <button
                onClick={(e) => handleToggleFavorite(e, chatroom._id)}
                className={`w-7 h-7 flex items-center justify-center transition-all duration-100 ${
                  chatroom.isFavorite
                    ? 'text-yellow-500 hover:text-yellow-400'
                    : 'text-chatroom-text-muted hover:text-yellow-500'
                }`}
                title={chatroom.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star size={14} fill={chatroom.isFavorite ? 'currentColor' : 'none'} />
              </button>
            </div>
            {/* Name */}
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary truncate">
                {displayName}
              </span>
              <span className="font-mono text-[9px] text-chatroom-text-muted truncate">
                {chatroom._id}
              </span>
            </div>
            {/* Status */}
            <div className="flex items-center">
              <span className={getStatusBadgeClasses(chatroom.chatStatus)}>{statusLabel}</span>
            </div>
            {/* Agents */}
            <div className="flex items-center gap-2 min-w-[140px]">
              {teamRoles.map((role) => {
                const agent = agentMap.get(role.toLowerCase());
                const effectiveStatus = agent?.effectiveStatus || 'disconnected';
                return (
                  <div key={role} className="flex items-center gap-1">
                    <span className={getAgentIndicatorClasses(effectiveStatus)} />
                    <span className="text-[9px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                      {role}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Created */}
            <div className="flex items-center justify-end">
              <span className="text-[10px] font-mono tabular-nums text-chatroom-text-muted">
                {formattedDate}
              </span>
            </div>
            {/* Actions */}
            <div
              className="flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
              role="button"
              tabIndex={-1}
            >
              {chatroom.chatStatus !== 'completed' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className="w-7 h-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-tertiary transition-all duration-100 cursor-pointer">
                      <MoreVertical size={14} />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    <DropdownMenuItem onClick={(e) => handleMarkComplete(e, chatroom._id)}>
                      <CheckCircle size={14} className="mr-2" />
                      Mark Complete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
});

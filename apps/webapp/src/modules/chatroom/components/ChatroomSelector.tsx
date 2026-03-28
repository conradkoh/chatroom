'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { MessageSquare, MoreVertical, CheckCircle, LayoutGrid, List, Search, Star, X } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useRef } from 'react';

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

// Agent status indicator — uses isAlive from spawnedAgentPid (authoritative source)
function getAgentIndicatorClasses(isAlive: boolean): string {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  return isAlive
    ? `${base} bg-chatroom-status-success`
    : `${base} bg-chatroom-text-muted opacity-40`;
}

// ─── Sorting & Filtering ──────────────────────────────────────────────────────

/**
 * Groups chatrooms into priority-ordered sections:
 *   1. Active — agents present and engaged (working/active)
 *   2. Recent — top N most recently active idle chatrooms
 *   3. Remainder — all other non-completed chatrooms
 *
 * This mirrors the ordering used in ChatroomSidebar.
 */
function groupChatrooms(chatrooms: ChatroomWithStatus[]): {
  active: ChatroomWithStatus[];
  recent: ChatroomWithStatus[];
  remainder: ChatroomWithStatus[];
  completed: ChatroomWithStatus[];
} {
  const completed = chatrooms.filter((c) => c.chatStatus === 'completed');

  // Active: agents present and engaged, sorted by creation time ASC (stable)
  const active = chatrooms
    .filter((c) => c.chatStatus === 'working' || c.chatStatus === 'active')
    .sort((a, b) => a._creationTime - b._creationTime);

  // Recent: top 5 by lastActivityAt, excluding active and completed
  const activeIds = new Set(active.map((c) => c._id));
  const idle = chatrooms.filter(
    (c) => !activeIds.has(c._id) && c.chatStatus !== 'completed'
  );
  const sortedIdle = [...idle].sort((a, b) => {
    const aTime = a.lastActivityAt || a._creationTime;
    const bTime = b.lastActivityAt || b._creationTime;
    return bTime - aTime || a._id.localeCompare(b._id);
  });
  const recent = sortedIdle.slice(0, 5);
  const recentIds = new Set(recent.map((c) => c._id));

  // Remainder: everything else (not active, not recent, not completed)
  const remainder = sortedIdle.filter((c) => !recentIds.has(c._id));

  return { active, recent, remainder, completed };
}

/**
 * Filters chatrooms by a search query.
 * Matches against chatroom name, team name, and ID (case-insensitive).
 */
function filterChatrooms(chatrooms: ChatroomWithStatus[], query: string): ChatroomWithStatus[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return chatrooms;

  return chatrooms.filter((c) => {
    const name = (c.name || '').toLowerCase();
    const teamName = (c.teamName || '').toLowerCase();
    const id = c._id.toLowerCase();
    return name.includes(lower) || teamName.includes(lower) || id.includes(lower);
  });
}

export function ChatroomSelector({ onSelect }: ChatroomSelectorProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use context for chatroom data - single source of truth
  const { chatrooms, isLoading } = useChatroomListing();

  const handleCreated = useCallback(
    (chatroomId: string) => {
      setShowCreateForm(false);
      onSelect(chatroomId);
    },
    [onSelect]
  );

  // Filter chatrooms by search query, then group into priority sections
  const filtered = useMemo(() => {
    if (!chatrooms) return undefined;
    return filterChatrooms(chatrooms, searchQuery);
  }, [chatrooms, searchQuery]);

  const groups = useMemo(() => {
    if (!filtered) return { active: [], recent: [], remainder: [], completed: [] };
    return groupChatrooms(filtered);
  }, [filtered]);

  // Ordered list for the "current" tab: active → recent → remainder
  const orderedCurrent = useMemo(
    () => [...groups.active, ...groups.recent, ...groups.remainder],
    [groups]
  );

  // Compute favorite chatrooms
  const favorites = useMemo(() => {
    if (!filtered) return [];
    return filtered.filter((c) => c.isFavorite);
  }, [filtered]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

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

      {/* Search Input */}
      <div className="mb-6">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chatrooms..."
            className="w-full bg-chatroom-bg-surface border-2 border-chatroom-border text-chatroom-text-primary pl-9 pr-9 py-2 text-xs font-mono placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent transition-colors"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Favorites Section */}
      {favorites.length > 0 && activeTab === 'current' && !searchQuery && (
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

      {/* Chatroom List — ordered: active → recent → remainder */}
      {activeTab === 'current' ? (
        viewMode === 'grid' ? (
          orderedCurrent.length > 0 ? (
            <div className="space-y-6">
              {/* Active Section */}
              {groups.active.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="w-1.5 h-1.5 bg-chatroom-status-success flex-shrink-0" />
                    <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
                      Active
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.active.map((chatroom) => (
                      <ChatroomCard key={chatroom._id} chatroom={chatroom} onSelect={onSelect} activeTab={activeTab} />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Section */}
              {groups.recent.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
                    Recent
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.recent.map((chatroom) => (
                      <ChatroomCard key={chatroom._id} chatroom={chatroom} onSelect={onSelect} activeTab={activeTab} />
                    ))}
                  </div>
                </div>
              )}

              {/* Remainder Section */}
              {groups.remainder.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
                    Older
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.remainder.map((chatroom) => (
                      <ChatroomCard key={chatroom._id} chatroom={chatroom} onSelect={onSelect} activeTab={activeTab} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-chatroom-text-muted">
              {searchQuery ? 'No chatrooms match your search' : 'No current chatrooms'}
            </div>
          )
        ) : (
          <ChatroomTable chatrooms={orderedCurrent} onSelect={onSelect} activeTab={activeTab} />
        )
      ) : viewMode === 'grid' ? (
        groups.completed.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.completed.map((chatroom) => (
              <ChatroomCard key={chatroom._id} chatroom={chatroom} onSelect={onSelect} activeTab={activeTab} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-chatroom-text-muted">
            {searchQuery ? 'No completed chatrooms match your search' : 'No completed chatrooms'}
          </div>
        )
      ) : (
        <ChatroomTable chatrooms={groups.completed} onSelect={onSelect} activeTab={activeTab} />
      )}
    </div>
  );
}

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
  const updateStatus = useSessionMutation(api.chatrooms.updateStatus);
  const toggleFavorite = useSessionMutation(api.chatrooms.toggleFavorite);

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

  const handleArchive = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      try {
        await updateStatus({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
          status: 'completed',
        });
      } catch (error) {
        console.error('Failed to archive chat:', error);
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

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        className="bg-chatroom-bg-surface border-2 border-chatroom-border p-3 md:p-4 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer w-full"
        onClick={() => onSelect(chatroom._id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(chatroom._id);
          }
        }}
        data-chat-status={chatStatus}
      >
        {/* Card Main */}
        <div className="flex justify-between items-start mb-2 md:mb-3">
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
                  <DropdownMenuItem onClick={handleArchive}>
                    <CheckCircle size={14} className="mr-2" />
                    Archive Chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="font-mono text-[10px] text-chatroom-text-muted truncate mb-2 md:mb-3">
          {chatroom._id}
        </div>
        {/* Card Agents */}
        <div className="flex flex-wrap gap-2 mb-2 md:mb-3">
          {teamRoles.map((role) => {
            const agent = agentMap.get(role.toLowerCase());
            return (
              <div key={role} className="flex items-center gap-1.5">
                <span className={getAgentIndicatorClasses(agent?.isAlive ?? false)} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                  {role}
                </span>
              </div>
            );
          })}
        </div>
        {/* Card Date */}
        <div className="text-[10px] text-chatroom-text-muted">{formattedDate}</div>
      </div>
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
  const updateStatus = useSessionMutation(api.chatrooms.updateStatus);
  const toggleFavorite = useSessionMutation(api.chatrooms.toggleFavorite);

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

  const handleArchive = useCallback(
    async (e: React.MouseEvent, chatroomId: string) => {
      e.stopPropagation();
      try {
        await updateStatus({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          status: 'completed',
        });
      } catch (error) {
        console.error('Failed to archive chat:', error);
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
      <div className="grid grid-cols-[32px_1fr_auto_100px_40px] gap-4 px-4 py-2 bg-chatroom-bg-tertiary border-b-2 border-chatroom-border">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Name
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
            className="grid grid-cols-[32px_1fr_auto_100px_40px] gap-4 px-4 py-3 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-all duration-100 text-left w-full"
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
            {/* Agents */}
            <div className="flex items-center gap-2 min-w-[140px]">
              {teamRoles.map((role) => {
                const agent = agentMap.get(role.toLowerCase());
                return (
                  <div key={role} className="flex items-center gap-1">
                    <span className={getAgentIndicatorClasses(agent?.isAlive ?? false)} />
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
                    <DropdownMenuItem onClick={(e) => handleArchive(e, chatroom._id)}>
                      <CheckCircle size={14} className="mr-2" />
                      Archive Chat
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

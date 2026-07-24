'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Archive, ChevronDown, Mail, MessageSquare, Play, Square, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { UnifiedAgentListModal } from './AgentPanel/UnifiedAgentListModal';
import { createChatroomSelectKeyDown } from './chatroom-select-keydown';
import { useChatroomListing, type ChatroomWithStatus } from '../context/ChatroomListingContext';
import { getChatStatusIndicatorClasses } from '../utils/chatStatusDisplay';
import { partitionChatroomListing, RECENCY_SECTIONS } from '../utils/partitionChatroomListing';
import { getChatroomDisplayName } from '../viewModels/chatroomViewModel';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface ChatroomSidebarItemProps {
  chatroom: ChatroomWithStatus;
  isActive: boolean;
  onSelect: (chatroomId: string) => void;
}

const ChatroomSidebarItem = memo(function ChatroomSidebarItem({
  chatroom,
  isActive,
  onSelect,
}: ChatroomSidebarItemProps) {
  const displayName = getChatroomDisplayName(chatroom);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const sendCommand = useSessionMutation(api.machines.sendCommand);
  const restartOfflineAgents = useSessionMutation(api.machines.restartOfflineAgentsFromConfig);
  const updateStatus = useSessionMutation(api.chatrooms.updateStatus);
  const markAsUnread = useSessionMutation(api.chatrooms.markAsUnread);

  const handleStop = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      await Promise.all(
        chatroom.runningAgentConfigs.map(({ machineId, role }) =>
          sendCommand({
            machineId,
            type: 'stop-agent',
            payload: { chatroomId: chatroom._id as Id<'chatroom_rooms'>, role },
          })
        )
      );
    },
    [chatroom.runningAgentConfigs, chatroom._id, sendCommand]
  );

  const handleStart = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (isStarting) return;
      setIsStarting(true);
      try {
        const result = await restartOfflineAgents({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
        if (result.restartedRoles.length > 0) {
          toast.success(
            result.restartedRoles.length === 1
              ? `Started ${result.restartedRoles[0]}`
              : `Started ${result.restartedRoles.join(', ')}`
          );
        } else {
          setStartModalOpen(true);
        }
      } catch (error) {
        console.error('Failed to restart offline agents:', error);
        setStartModalOpen(true);
      } finally {
        setIsStarting(false);
      }
    },
    [chatroom._id, isStarting, restartOfflineAgents]
  );

  const handleArchive = useCallback(
    async (e: Event) => {
      e.preventDefault();
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

  const handleMarkAsUnread = useCallback(
    async (e: Event) => {
      e.preventDefault();
      try {
        await markAsUnread({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to mark chat as unread:', error);
      }
    },
    [markAsUnread, chatroom._id]
  );

  const isCompleted = chatroom.chatStatus === 'completed' || chatroom.status === 'completed';

  const showStartButton =
    chatroom.status !== 'completed' &&
    chatroom.teamId &&
    (chatroom.remoteAgentStatus === 'stopped' || chatroom.remoteAgentStatus === 'none');

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className={`w-full cursor-pointer text-left px-3 py-2 flex items-center gap-2 transition-all duration-100 border-b border-chatroom-border ${
              isActive
                ? 'bg-chatroom-bg-hover border-l-2 border-l-chatroom-accent'
                : 'border-l-2 border-l-transparent hover:bg-chatroom-bg-hover hover:border-l-chatroom-border'
            }`}
            onClick={() => onSelect(chatroom._id)}
            onKeyDown={createChatroomSelectKeyDown(() => onSelect(chatroom._id))}
          >
            {/* Status indicator - square per theme guidelines */}
            <span className={getChatStatusIndicatorClasses(chatroom.chatStatus)} />

            {/* Name + inline unread */}
            <span className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className="text-xs font-bold uppercase tracking-wide truncate text-chatroom-text-primary">
                {displayName}
              </span>
              {chatroom.hasUnread && (
                <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />
              )}
            </span>

            {/* Favorite star indicator */}
            {chatroom.isFavorite && (
              <Star size={10} className="text-yellow-500 flex-shrink-0" fill="currentColor" />
            )}

            {/* Remote agent stop button */}
            {chatroom.remoteAgentStatus === 'running' && (
              <button
                onClick={handleStop}
                title="Stop agent"
                className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
              >
                <Square size={8} fill="currentColor" />
              </button>
            )}

            {/* Remote agent start button */}
            {showStartButton && (
              <button
                onClick={handleStart}
                title="Start with last configuration"
                disabled={isStarting}
                aria-busy={isStarting}
                className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                <Play size={10} fill="currentColor" />
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        {!isCompleted && (
          <ContextMenuContent className="min-w-[160px] rounded-none">
            <ContextMenuItem onSelect={handleMarkAsUnread} className="rounded-none">
              <Mail size={14} />
              Mark as Unread
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleArchive} className="rounded-none">
              <Archive size={14} />
              Archive Chat
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {startModalOpen && (
        <UnifiedAgentListModal
          isOpen={startModalOpen}
          onClose={() => setStartModalOpen(false)}
          chatroomId={chatroom._id}
        />
      )}
    </>
  );
});

interface ChatroomSidebarProps {
  /** Currently active chatroom ID */
  activeChatroomId?: string;
}

function SidebarSectionHeader({
  label,
  withTopBorder = false,
  indicatorClassName,
}: {
  label: string;
  withTopBorder?: boolean;
  indicatorClassName?: string;
}) {
  return (
    <div
      className={`px-3 py-2 flex items-center gap-1.5 bg-chatroom-bg-tertiary ${withTopBorder ? 'border-t border-chatroom-border' : ''}`}
    >
      {indicatorClassName ? (
        <span className={`w-1.5 h-1.5 flex-shrink-0 ${indicatorClassName}`} />
      ) : null}
      <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
        {label}
      </span>
    </div>
  );
}

/**
 * Dense sidebar showing all chatrooms with status and unread indicators.
 * Designed for desktop use within the chatroom view to allow quick switching.
 *
 * Sections:
 * - Active: Chatrooms with chatStatus 'working', 'active', or 'transitioning' (agents online)
 * - Last Day / Last Week / Last Month / Older: Non-active chatrooms grouped by last activity
 * - Completed: Collapsible section for completed chatrooms
 *
 * Favorites are indicated by a star icon on the chatroom item rather than a separate section.
 */
export const ChatroomSidebar = memo(function ChatroomSidebar({
  activeChatroomId,
}: ChatroomSidebarProps) {
  const router = useRouter();
  const { chatrooms, isLoading } = useChatroomListing();
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Compute sections
  const { activeChatrooms, recentByRecency, completed } = useMemo(() => {
    if (!chatrooms) {
      return {
        activeChatrooms: [],
        recentByRecency: partitionChatroomListing([]).recentByRecency,
        completed: [],
      };
    }
    const partitioned = partitionChatroomListing(chatrooms);
    return {
      activeChatrooms: partitioned.active,
      recentByRecency: partitioned.recentByRecency,
      completed: partitioned.completed,
    };
  }, [chatrooms]);

  const hasRecentChatrooms = RECENCY_SECTIONS.some(({ key }) => recentByRecency[key].length > 0);

  const handleSelect = (chatroomId: string) => {
    if (chatroomId === activeChatroomId) return;
    router.push(`/app/chatroom?id=${chatroomId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <ChatroomLoader size="sm" />
      </div>
    );
  }

  if (!chatrooms || chatrooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-chatroom-text-muted">
        <MessageSquare size={16} className="mb-2 opacity-50" />
        <span className="text-[10px] uppercase tracking-wide">No chatrooms</span>
      </div>
    );
  }

  return (
    <div className="chatroom-root flex flex-col w-full h-full overflow-hidden bg-chatroom-bg-surface">
      {/* Header - consistent with AgentPanel */}
      <div className="flex items-center justify-between h-14 px-4 border-b-2 border-chatroom-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatrooms
        </div>
      </div>
      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* Active Section - chatrooms with agents present and engaged */}
        {activeChatrooms.length > 0 && (
          <>
            <SidebarSectionHeader label="Active" indicatorClassName="bg-chatroom-status-success" />
            {activeChatrooms.map((chatroom) => (
              <ChatroomSidebarItem
                key={chatroom._id}
                chatroom={chatroom}
                isActive={chatroom._id === activeChatroomId}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}

        {hasRecentChatrooms &&
          RECENCY_SECTIONS.map(({ key, label }, index) => {
            const sectionChatrooms = recentByRecency[key];
            if (sectionChatrooms.length === 0) return null;

            return (
              <React.Fragment key={key}>
                <SidebarSectionHeader
                  label={label}
                  withTopBorder={activeChatrooms.length > 0 || index > 0}
                />
                {sectionChatrooms.map((chatroom) => (
                  <ChatroomSidebarItem
                    key={chatroom._id}
                    chatroom={chatroom}
                    isActive={chatroom._id === activeChatroomId}
                    onSelect={handleSelect}
                  />
                ))}
              </React.Fragment>
            );
          })}

        {/* Completed Section - Collapsible */}
        {completed.length > 0 && (
          <>
            <button
              className="w-full px-3 py-2 bg-chatroom-bg-tertiary border-t border-chatroom-border flex items-center justify-between hover:bg-chatroom-bg-hover"
              onClick={() => setCompletedExpanded(!completedExpanded)}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                Completed ({completed.length})
              </span>
              <ChevronDown
                className={`w-3 h-3 text-chatroom-text-muted transition-transform ${
                  completedExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>
            {completedExpanded &&
              completed.map((chatroom) => (
                <ChatroomSidebarItem
                  key={chatroom._id}
                  chatroom={chatroom}
                  isActive={chatroom._id === activeChatroomId}
                  onSelect={handleSelect}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
});

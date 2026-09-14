'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Archive, ChevronDown, Mail, MailOpen, MessageSquare, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { memo, useCallback, useMemo, useState } from 'react';

import { createChatroomSelectKeyDown } from './chatroom-select-keydown';
import { ChatroomSidebarAgentActions } from './ChatroomSidebarAgentActions';
import { ChatroomSidebarSkeleton } from './ChatroomSidebarSkeleton';
import { LifecycleConfirmDialog } from './LifecycleConfirmDialog';
import { useChatroomListing, type ChatroomWithStatus } from '../context/ChatroomListingContext';
import { useChatroomStatus, useChatroomStatusMap } from '../hooks/useChatroomStatus';
import {
  getChatroomActivityIndicatorClasses,
  getChatroomActivityIndicatorLoadingClasses,
} from '../utils/activityStatusDisplay';
import { partitionChatroomListing, RECENCY_SECTIONS } from '../utils/partitionChatroomListing';
import { getChatroomDisplayName } from '../viewModels/chatroomViewModel';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

interface ChatroomSidebarItemProps {
  chatroom: ChatroomWithStatus;
  isActive: boolean;
  onSelect: (chatroomId: string) => void;
}

interface ChatroomSidebarItemTriggerProps {
  chatroom: ChatroomWithStatus;
  chatroomStatus: ChatroomStatus | undefined;
  displayName: string;
  isActive: boolean;
  showStart: boolean;
  onSelect: (chatroomId: string) => void;
}

function ChatroomSidebarItemIdentity({
  chatroom,
  chatroomStatus,
  displayName,
}: Pick<ChatroomSidebarItemTriggerProps, 'chatroom' | 'chatroomStatus' | 'displayName'>) {
  return (
    <>
      <span
        className={
          chatroomStatus
            ? getChatroomActivityIndicatorClasses(chatroomStatus.activityStatus)
            : getChatroomActivityIndicatorLoadingClasses()
        }
      />
      <span className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
        <span className="text-xs font-bold uppercase tracking-wide truncate text-chatroom-text-primary">
          {displayName}
        </span>
        {chatroom.hasUnread && <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />}
      </span>
      {chatroom.isFavorite && (
        <Star size={10} className="text-yellow-500 flex-shrink-0" fill="currentColor" />
      )}
    </>
  );
}

function ChatroomSidebarItemTrigger({
  chatroom,
  chatroomStatus,
  displayName,
  isActive,
  showStart,
  onSelect,
}: ChatroomSidebarItemTriggerProps) {
  return (
    <ContextMenuTrigger
      render={
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
        />
      }
    >
      <ChatroomSidebarItemIdentity
        chatroom={chatroom}
        chatroomStatus={chatroomStatus}
        displayName={displayName}
      />
      <ChatroomSidebarAgentActions
        chatroomId={chatroom._id}
        canStop={Boolean(chatroomStatus?.canStop)}
        showStart={showStart}
        isRunning={chatroomStatus?.remoteAgentStatus === 'running'}
      />
    </ContextMenuTrigger>
  );
}

function ChatroomSidebarItemMenu({
  isCompleted,
  hasUnread,
  onToggleReadStatus,
  onArchive,
}: {
  isCompleted: boolean;
  hasUnread: boolean;
  onToggleReadStatus: () => void;
  onArchive: () => void;
}) {
  if (isCompleted) return null;

  return (
    <ContextMenuContent className="min-w-[160px] rounded-none">
      <ContextMenuItem onSelect={onToggleReadStatus} className="rounded-none">
        {hasUnread ? (
          <>
            <MailOpen size={14} />
            Mark as Read
          </>
        ) : (
          <>
            <Mail size={14} />
            Mark as Unread
          </>
        )}
      </ContextMenuItem>
      <ContextMenuItem onSelect={onArchive} className="rounded-none">
        <Archive size={14} />
        Archive Chat
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

const ChatroomSidebarItem = memo(function ChatroomSidebarItem({
  chatroom,
  isActive,
  onSelect,
}: ChatroomSidebarItemProps) {
  const displayName = getChatroomDisplayName(chatroom);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const markAsRead = useSessionMutation(api.chatrooms.markAsRead);
  const markAsUnread = useSessionMutation(api.chatrooms.markAsUnread);
  const { status: chatroomStatus } = useChatroomStatus(chatroom._id);

  const handleArchive = useCallback(() => {
    setArchiveDialogOpen(true);
  }, []);

  const handleToggleReadStatus = useCallback(async () => {
    try {
      if (chatroom.hasUnread) {
        await markAsRead({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      } else {
        await markAsUnread({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      }
    } catch (error) {
      console.error('Failed to update read status:', error);
    }
  }, [chatroom.hasUnread, chatroom._id, markAsRead, markAsUnread]);

  const isCompleted = chatroomStatus?.state === 'completed' || chatroom.status === 'completed';

  const showStartButton =
    chatroom.status !== 'completed' &&
    chatroom.teamId &&
    chatroomStatus !== undefined &&
    (chatroomStatus.remoteAgentStatus === 'stopped' || chatroomStatus.remoteAgentStatus === 'none');

  return (
    <>
      <ContextMenu>
        <ChatroomSidebarItemTrigger
          chatroom={chatroom}
          chatroomStatus={chatroomStatus}
          displayName={displayName}
          isActive={isActive}
          showStart={Boolean(showStartButton)}
          onSelect={onSelect}
        />
        <ChatroomSidebarItemMenu
          isCompleted={isCompleted}
          hasUnread={chatroom.hasUnread}
          onToggleReadStatus={handleToggleReadStatus}
          onArchive={handleArchive}
        />
      </ContextMenu>

      <LifecycleConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        chatroomId={chatroom._id as Id<'chatroom_rooms'>}
        action="archive"
      />
    </>
  );
});

interface ChatroomSidebarProps {
  /** Currently active chatroom ID */
  activeChatroomId?: string;
}

type SidebarSections = ReturnType<typeof partitionChatroomListing>;
interface ChatroomSidebarContentProps {
  activeChatrooms: SidebarSections['active'];
  recentByRecency: SidebarSections['recentByRecency'];
  completed: SidebarSections['completed'];
  hasRecentChatrooms: boolean;
  completedExpanded: boolean;
  activeChatroomId?: string;
  onSelect: (chatroomId: string) => void;
  onToggleCompleted: () => void;
}

function ActiveChatroomSection({
  chatrooms,
  activeChatroomId,
  onSelect,
}: Pick<ChatroomSidebarContentProps, 'activeChatroomId' | 'onSelect'> & {
  chatrooms: SidebarSections['active'];
}) {
  if (chatrooms.length === 0) return null;

  return (
    <>
      <SidebarSectionHeader label="Active" indicatorClassName="bg-chatroom-status-success" />
      {chatrooms.map((chatroom) => (
        <ChatroomSidebarItem
          key={chatroom._id}
          chatroom={chatroom}
          isActive={chatroom._id === activeChatroomId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function RecentChatroomSections({
  recentByRecency,
  hasRecentChatrooms,
  activeChatroomsCount,
  activeChatroomId,
  onSelect,
}: Pick<ChatroomSidebarContentProps, 'activeChatroomId' | 'hasRecentChatrooms' | 'onSelect'> & {
  recentByRecency: SidebarSections['recentByRecency'];
  activeChatroomsCount: number;
}) {
  if (!hasRecentChatrooms) return null;

  return RECENCY_SECTIONS.map(({ key, label }, index) => {
    const chatrooms = recentByRecency[key];
    if (chatrooms.length === 0) return null;
    return (
      <React.Fragment key={key}>
        <SidebarSectionHeader label={label} withTopBorder={activeChatroomsCount > 0 || index > 0} />
        {chatrooms.map((chatroom) => (
          <ChatroomSidebarItem
            key={chatroom._id}
            chatroom={chatroom}
            isActive={chatroom._id === activeChatroomId}
            onSelect={onSelect}
          />
        ))}
      </React.Fragment>
    );
  });
}

function CompletedChatroomSection({
  chatrooms,
  expanded,
  activeChatroomId,
  onSelect,
  onToggle,
}: Pick<ChatroomSidebarContentProps, 'activeChatroomId' | 'onSelect'> & {
  chatrooms: SidebarSections['completed'];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (chatrooms.length === 0) return null;

  return (
    <>
      <button
        className="w-full px-3 py-2 bg-chatroom-bg-tertiary border-t border-chatroom-border flex items-center justify-between hover:bg-chatroom-bg-hover"
        onClick={onToggle}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          Completed ({chatrooms.length})
        </span>
        <ChevronDown
          className={`w-3 h-3 text-chatroom-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded &&
        chatrooms.map((chatroom) => (
          <ChatroomSidebarItem
            key={chatroom._id}
            chatroom={chatroom}
            isActive={chatroom._id === activeChatroomId}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function ChatroomSidebarContent({
  activeChatrooms,
  recentByRecency,
  completed,
  hasRecentChatrooms,
  completedExpanded,
  activeChatroomId,
  onSelect,
  onToggleCompleted,
}: ChatroomSidebarContentProps) {
  return (
    <div className="chatroom-root flex flex-col w-full h-full overflow-hidden bg-chatroom-bg-surface">
      <div className="flex items-center justify-between h-14 px-4 border-b-2 border-chatroom-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatrooms
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ActiveChatroomSection
          chatrooms={activeChatrooms}
          activeChatroomId={activeChatroomId}
          onSelect={onSelect}
        />
        <RecentChatroomSections
          recentByRecency={recentByRecency}
          hasRecentChatrooms={hasRecentChatrooms}
          activeChatroomsCount={activeChatrooms.length}
          activeChatroomId={activeChatroomId}
          onSelect={onSelect}
        />
        <CompletedChatroomSection
          chatrooms={completed}
          expanded={completedExpanded}
          activeChatroomId={activeChatroomId}
          onSelect={onSelect}
          onToggle={onToggleCompleted}
        />
      </div>
    </div>
  );
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
 * - Active: Chatrooms with state 'active' or 'attention' (projected activity)
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
  const chatroomIds = useMemo(() => chatrooms?.map((chatroom) => chatroom._id) ?? [], [chatrooms]);
  const { statuses } = useChatroomStatusMap(chatroomIds);

  // Compute sections
  const { activeChatrooms, recentByRecency, completed } = useMemo(() => {
    if (!chatrooms) {
      return {
        activeChatrooms: [],
        recentByRecency: partitionChatroomListing([], statuses).recentByRecency,
        completed: [],
      };
    }
    const partitioned = partitionChatroomListing(chatrooms, statuses);
    return {
      activeChatrooms: partitioned.active,
      recentByRecency: partitioned.recentByRecency,
      completed: partitioned.completed,
    };
  }, [chatrooms, statuses]);

  const hasRecentChatrooms = RECENCY_SECTIONS.some(({ key }) => recentByRecency[key].length > 0);

  const handleSelect = useCallback(
    (chatroomId: string) => {
      if (chatroomId === activeChatroomId) return;
      router.push(`/app/chatroom?id=${chatroomId}`);
    },
    [activeChatroomId, router]
  );

  if (isLoading) {
    return <ChatroomSidebarSkeleton />;
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
    <ChatroomSidebarContent
      activeChatrooms={activeChatrooms}
      recentByRecency={recentByRecency}
      completed={completed}
      hasRecentChatrooms={hasRecentChatrooms}
      completedExpanded={completedExpanded}
      activeChatroomId={activeChatroomId}
      onSelect={handleSelect}
      onToggleCompleted={() => setCompletedExpanded(!completedExpanded)}
    />
  );
});

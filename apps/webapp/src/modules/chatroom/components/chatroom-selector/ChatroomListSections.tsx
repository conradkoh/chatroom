'use client';

import { ChatroomCard } from './ChatroomCard';
import type { TabType, ViewMode } from './chatroomSelectorModel';
import { ChatroomTable } from './ChatroomTable';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';
import { RECENCY_SECTIONS } from '../../utils/partitionChatroomListing';

import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

interface PartitionedChatrooms {
  active: ChatroomWithStatus[];
  recentByRecency: Record<string, ChatroomWithStatus[]>;
  completed: ChatroomWithStatus[];
}

interface ChatroomListProps {
  viewMode: ViewMode;
  statuses: ReadonlyMap<string, ChatroomStatus>;
  searchQuery: string;
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}

function EmptyListMessage({ message }: { message: string }) {
  return <div className="text-center py-12 text-chatroom-text-muted">{message}</div>;
}

function currentEmptyMessage(searchQuery: string): string {
  return searchQuery ? 'No chatrooms match your search' : 'No current chatrooms';
}

function completedEmptyMessage(searchQuery: string): string {
  return searchQuery ? 'No completed chatrooms match your search' : 'No completed chatrooms';
}

/** Responsive card grid used by both tabs. */
function ChatroomCardGrid({
  chatrooms,
  onSelect,
  activeTab,
}: {
  chatrooms: ChatroomWithStatus[];
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {chatrooms.map((chatroom) => (
        <ChatroomCard
          key={chatroom._id}
          chatroom={chatroom}
          onSelect={onSelect}
          activeTab={activeTab}
        />
      ))}
    </div>
  );
}

/** Current tab: an Active section, then recency buckets. Falls back to the table view when selected. */
export function CurrentChatroomList({
  viewMode,
  partitioned,
  orderedCurrent,
  statuses,
  searchQuery,
  onSelect,
  activeTab,
}: ChatroomListProps & {
  partitioned: PartitionedChatrooms;
  orderedCurrent: ChatroomWithStatus[];
}) {
  if (viewMode === 'table') {
    return (
      <ChatroomTable
        chatrooms={orderedCurrent}
        statuses={statuses}
        onSelect={onSelect}
        activeTab={activeTab}
      />
    );
  }
  if (orderedCurrent.length === 0) {
    return <EmptyListMessage message={currentEmptyMessage(searchQuery)} />;
  }
  return (
    <div className="space-y-6">
      {partitioned.active.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <span className="w-1.5 h-1.5 bg-chatroom-status-success flex-shrink-0" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
              Active
            </h2>
          </div>
          <ChatroomCardGrid
            chatrooms={partitioned.active}
            onSelect={onSelect}
            activeTab={activeTab}
          />
        </div>
      )}

      {RECENCY_SECTIONS.map(({ key, label }) => {
        const items = partitioned.recentByRecency[key];
        if (items.length === 0) return null;
        return (
          <div key={key}>
            <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
              {label}
            </h2>
            <ChatroomCardGrid chatrooms={items} onSelect={onSelect} activeTab={activeTab} />
          </div>
        );
      })}
    </div>
  );
}

/** Complete tab: a flat grid, or the table view when selected. */
export function CompletedChatroomList({
  viewMode,
  completed,
  statuses,
  searchQuery,
  onSelect,
  activeTab,
}: ChatroomListProps & { completed: ChatroomWithStatus[] }) {
  if (viewMode === 'table') {
    return (
      <ChatroomTable
        chatrooms={completed}
        statuses={statuses}
        onSelect={onSelect}
        activeTab={activeTab}
      />
    );
  }
  if (completed.length === 0) {
    return <EmptyListMessage message={completedEmptyMessage(searchQuery)} />;
  }
  return <ChatroomCardGrid chatrooms={completed} onSelect={onSelect} activeTab={activeTab} />;
}

'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { ConversationSlicePanel } from './ConversationSlicePanel';
import type { MachineNameEntry } from './timelineRowStyles';
import { TimelineUserMessage } from './TimelineUserMessage';
import { useFilteredUserMessages } from '../../hooks/useFilteredUserMessages';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { cn } from '@/lib/utils';

interface FilteredUserMessagesViewProps {
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
}

// fallow-ignore-next-line complexity
export function FilteredUserMessagesView({ chatroomId, machines }: FilteredUserMessagesViewProps) {
  const { messages, isLoading, isLoadingMore, canLoadMore, loadMore } = useFilteredUserMessages(
    chatroomId,
    true
  );

  const [selectedAnchorId, setSelectedAnchorId] = useState<Id<'chatroom_messages'> | null>(null);

  const listContent = (
    <>
      {isLoading && messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <ChatroomLoader size="md" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <MessageSquare size={32} className="mb-4" />
          <div>No user messages yet</div>
        </div>
      ) : (
        messages.map((message) => (
          <button
            key={message._id}
            type="button"
            onClick={() => setSelectedAnchorId(message._id as Id<'chatroom_messages'>)}
            className={cn(
              'w-full text-left cursor-pointer transition-colors hover:bg-chatroom-bg-hover/40',
              selectedAnchorId === message._id && 'ring-2 ring-inset ring-chatroom-accent/50'
            )}
            data-testid={`filtered-user-message-${message._id}`}
          >
            <TimelineUserMessage message={message} chatroomId={chatroomId} />
          </button>
        ))
      )}
      {isLoadingMore && (
        <div className="py-2 flex justify-center">
          <ChatroomLoader size="sm" />
        </div>
      )}
    </>
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden" data-testid="filtered-user-messages-view">
      {/* List pane */}
      <div
        onScroll={(e) => {
          if (!canLoadMore || isLoadingMore) return;
          const { scrollHeight, scrollTop, clientHeight } = e.currentTarget;
          if (scrollHeight - scrollTop - clientHeight < 120) loadMore();
        }}
        className={cn(
          'overflow-y-auto min-h-0',
          selectedAnchorId
            ? 'hidden md:block md:w-2/5 lg:w-1/3 border-r-2 border-chatroom-border-strong'
            : 'flex-1 w-full'
        )}
      >
        {listContent}
      </div>

      {/* Slice panel — desktop inline */}
      {selectedAnchorId && (
        <div className="hidden md:flex flex-1 min-h-0 min-w-0">
          <ConversationSlicePanel
            chatroomId={chatroomId}
            anchorMessageId={selectedAnchorId}
            onClose={() => setSelectedAnchorId(null)}
            machines={machines}
          />
        </div>
      )}

      {/* Slice panel — mobile overlay */}
      {selectedAnchorId && (
        <div className="md:hidden fixed inset-0 top-14 z-40 flex flex-col bg-chatroom-bg-primary">
          <ConversationSlicePanel
            chatroomId={chatroomId}
            anchorMessageId={selectedAnchorId}
            onClose={() => setSelectedAnchorId(null)}
            machines={machines}
          />
        </div>
      )}
    </div>
  );
}

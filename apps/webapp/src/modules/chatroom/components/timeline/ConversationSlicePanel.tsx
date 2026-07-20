'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { TimelineEventRow } from './TimelineEventRow';
import type { MachineNameEntry } from './timelineRowStyles';
import { useConversationSlice } from '../../hooks/useConversationSlice';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

interface ConversationSlicePanelProps {
  chatroomId: string;
  anchorMessageId: Id<'chatroom_messages'>;
  onClose: () => void;
  machines?: Map<string, MachineNameEntry>;
}

// fallow-ignore-next-line complexity
export function ConversationSlicePanel({
  chatroomId,
  anchorMessageId,
  onClose,
  machines,
}: ConversationSlicePanelProps) {
  const { events, isLoading, isLoadingMore, canLoadMore, loadMore } = useConversationSlice(
    chatroomId,
    anchorMessageId
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // fallow-ignore-next-line complexity
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !canLoadMore || isLoadingMore) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) loadMore();
  }, [canLoadMore, isLoadingMore, loadMore]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="flex flex-1 flex-col min-h-0 min-w-0 w-full h-full border-l-2 border-chatroom-border-strong bg-chatroom-bg-primary"
      data-testid="conversation-slice-panel"
    >
      <div className="shrink-0 h-8 px-2 flex items-center justify-between border-b border-chatroom-border">
        <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          Conversation
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary"
          aria-label="Close conversation panel"
        >
          <X size={14} />
        </button>
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto min-h-0">
        {isLoading && events.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <ChatroomLoader size="sm" />
          </div>
        ) : events.length === 0 ? (
          <div className="p-4 text-sm text-chatroom-text-muted">No messages in this thread.</div>
        ) : (
          events.map((event) => (
            <TimelineEventRow
              key={event.id}
              event={event}
              chatroomId={chatroomId}
              machines={machines}
            />
          ))
        )}
        {isLoadingMore && (
          <div className="py-2 flex justify-center">
            <ChatroomLoader size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}

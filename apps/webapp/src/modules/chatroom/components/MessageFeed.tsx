'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ChevronUp, MessageSquare } from 'lucide-react';
import React, { useEffect, useRef, useMemo, memo, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { WorkingIndicator } from './WorkingIndicator';

import { useSessionPaginatedQuery } from '@/lib/useSessionPaginatedQuery';

interface Participant {
  _id?: string;
  role: string;
  status: string;
}

interface MessageFeedProps {
  chatroomId: string;
  participants: Participant[];
}

interface Message {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
  classification?: 'question' | 'new_feature' | 'follow_up';
  taskId?: string;
  taskStatus?: 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';
}

// Message type badge styling - using chatroom status variables for theme support
const getMessageTypeBadge = (type: string) => {
  const base = 'inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 mr-2';
  switch (type) {
    case 'handoff':
      return `${base} bg-chatroom-status-purple/15 text-chatroom-status-purple`;
    case 'interrupt':
      return `${base} bg-chatroom-status-error/15 text-chatroom-status-error`;
    case 'join':
      return `${base} bg-chatroom-status-success/15 text-chatroom-status-success`;
    default:
      return base;
  }
};

// Sender role styling
const getSenderClasses = (role: string) => {
  const base = 'font-bold text-xs uppercase tracking-wide';
  if (role === 'user') return `${base} text-chatroom-status-success`;
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
};

// Task status badge styling - shows processing status for user messages
const getTaskStatusBadge = (status: Message['taskStatus']) => {
  if (!status) return null;
  const base = 'inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 ml-2';
  switch (status) {
    case 'pending':
      return {
        className: `${base} bg-chatroom-status-success/15 text-chatroom-status-success`,
        label: '🟢 pending',
      };
    case 'in_progress':
      return {
        className: `${base} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: '🔵 in progress',
      };
    case 'queued':
      return {
        className: `${base} bg-chatroom-status-warning/15 text-chatroom-status-warning`,
        label: '🟡 queued',
      };
    case 'completed':
      return {
        className: `${base} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: '✅ done',
      };
    case 'cancelled':
      return {
        className: `${base} bg-chatroom-status-error/15 text-chatroom-status-error`,
        label: '❌ cancelled',
      };
    case 'backlog':
      return {
        className: `${base} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: '📋 backlog',
      };
    default:
      return null;
  }
};

// Classification badge styling - using chatroom status variables for theme support
const getClassificationBadge = (classification: Message['classification']) => {
  if (!classification) return null;
  const base = 'inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 ml-2';
  switch (classification) {
    case 'question':
      return {
        className: `${base} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: 'question',
      };
    case 'new_feature':
      return {
        className: `${base} bg-chatroom-status-warning/15 text-chatroom-status-warning`,
        label: 'new feature',
      };
    case 'follow_up':
      return {
        className: `${base} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'follow-up',
      };
    default:
      return null;
  }
};

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);

  return (
    <div className="px-4 py-3 bg-transparent border-b-2 border-chatroom-border transition-all duration-100 hover:bg-chatroom-accent-subtle hover:-mx-2 hover:px-6 last:border-b-0">
      {/* Message Header */}
      <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-chatroom-border">
        <div className="flex items-center flex-wrap gap-y-1">
          {message.type !== 'message' && (
            <span className={getMessageTypeBadge(message.type)}>{message.type}</span>
          )}
          <span className={getSenderClasses(message.senderRole)}>{message.senderRole}</span>
          {message.targetRole && (
            <span className="text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wide ml-2 before:content-['→_'] before:text-chatroom-text-muted">
              {message.targetRole}
            </span>
          )}
          {/* Show classification badge for user messages */}
          {message.senderRole.toLowerCase() === 'user' && classificationBadge && (
            <span className={classificationBadge.className}>{classificationBadge.label}</span>
          )}
          {/* Show task status badge for user messages with linked tasks */}
          {message.senderRole.toLowerCase() === 'user' && taskStatusBadge && (
            <span className={taskStatusBadge.className}>{taskStatusBadge.label}</span>
          )}
        </div>
        <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
          {formatTime(message._creationTime)}
        </span>
      </div>
      {/* Message Content */}
      <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
        <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
      </div>
    </div>
  );
});

// Number of messages to load initially and per page
const INITIAL_PAGE_SIZE = 5;
const LOAD_MORE_SIZE = 10;
// Threshold in pixels from top to trigger auto-load
const SCROLL_THRESHOLD = 100;

export const MessageFeed = memo(function MessageFeed({
  chatroomId,
  participants,
}: MessageFeedProps) {
  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const { results, status, loadMore, isLoading } = useSessionPaginatedQuery(
    chatroomApi.messages.listPaginated,
    { chatroomId: chatroomId as Id<'chatroom_rooms'> },
    { initialNumItems: INITIAL_PAGE_SIZE }
  ) as {
    results: Message[];
    status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
    isLoading: boolean;
    loadMore: (numItems: number) => void;
  };

  const feedRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevScrollHeightRef = useRef(0);

  // Filter out join messages and reverse to show oldest first (query returns newest first)
  const displayMessages = useMemo(() => {
    const filtered = (results || []).filter((m) => m.type !== 'join');
    // Reverse because paginated query returns newest first, but we want oldest at top
    return [...filtered].reverse();
  }, [results]);

  // Auto-scroll to bottom when new messages arrive (not when loading older messages)
  // Maintain scroll position when loading older messages
  useEffect(() => {
    if (feedRef.current) {
      const newScrollHeight = feedRef.current.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeightRef.current;

      if (displayMessages.length > prevMessageCountRef.current) {
        if (status === 'LoadingMore' || prevScrollHeightRef.current > 0) {
          // When loading older messages, maintain relative scroll position
          // by adding the height difference to current scroll
          if (heightDiff > 0 && feedRef.current.scrollTop < SCROLL_THRESHOLD + 50) {
            feedRef.current.scrollTop = feedRef.current.scrollTop + heightDiff;
          }
        } else {
          // New message arrived, scroll to bottom
          feedRef.current.scrollTop = feedRef.current.scrollHeight;
        }
      }

      prevScrollHeightRef.current = newScrollHeight;
    }
    prevMessageCountRef.current = displayMessages.length;
  }, [displayMessages.length, status]);

  // Handle scroll to detect when user is near the top
  const handleScroll = useCallback(() => {
    if (feedRef.current && status === 'CanLoadMore') {
      const { scrollTop } = feedRef.current;
      // Load more when user scrolls within threshold of top
      if (scrollTop < SCROLL_THRESHOLD) {
        loadMore(LOAD_MORE_SIZE);
      }
    }
  }, [status, loadMore]);

  if (status === 'LoadingFirstPage' || (isLoading && results.length === 0)) {
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
        </div>
      </div>
    );
  }

  if (displayMessages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <div className="text-5xl mb-4">
            <MessageSquare size={32} />
          </div>
          <div>No messages yet</div>
          <div className="text-chatroom-text-muted mt-2">Send a message to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Scrollable message content */}
      <div
        className="flex-1 overflow-y-auto p-4 min-h-0 scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
        ref={feedRef}
        onScroll={handleScroll}
      >
        {/* Load More indicator at top - shows when more messages available */}
        {status === 'CanLoadMore' && (
          <div className="w-full py-2 mb-2 text-[10px] text-chatroom-text-muted flex items-center justify-center gap-1">
            <ChevronUp size={12} />
            Scroll up to load older messages
          </div>
        )}
        {status === 'LoadingMore' && (
          <div className="w-full py-2 mb-2 text-sm text-chatroom-text-muted flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
            Loading...
          </div>
        )}
        {displayMessages.map((message) => (
          <MessageItem key={message._id} message={message} />
        ))}
        <WorkingIndicator participants={participants} />
      </div>
      {/* Sticky message counter - always visible at bottom */}
      <div className="px-4 py-1 text-[10px] text-chatroom-text-muted text-right bg-chatroom-bg-primary border-t border-chatroom-border">
        {displayMessages.length} messages loaded
      </div>
    </div>
  );
});

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

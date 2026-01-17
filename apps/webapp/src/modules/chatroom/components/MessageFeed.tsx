'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  ChevronUp,
  MessageSquare,
  Clock,
  Loader2,
  Timer,
  CheckCircle2,
  XCircle,
  Archive,
  ArrowRightLeft,
  LogIn,
  AlertCircle,
  HelpCircle,
  Sparkles,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
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

// Shared badge styling constants
const BADGE_BASE =
  'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5';
const ICON_SIZE = 10;

// Message type badge styling - with icons for visual consistency
const getMessageTypeBadge = (type: string) => {
  switch (type) {
    case 'handoff':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-purple/15 text-chatroom-status-purple`,
        label: 'handoff',
        icon: <ArrowRightLeft size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'interrupt':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-error/15 text-chatroom-status-error`,
        label: 'interrupt',
        icon: <AlertCircle size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'join':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-success/15 text-chatroom-status-success`,
        label: 'join',
        icon: <LogIn size={ICON_SIZE} className="flex-shrink-0" />,
      };
    default:
      return null;
  }
};

// Sender role styling - plain text with color (no background)
const getSenderClasses = (role: string) => {
  const base = 'font-bold text-[10px] uppercase tracking-wide';
  if (role === 'user') return `${base} text-chatroom-status-success`;
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
};

// Task status badge styling - shows processing status for user messages
// Per theme.md: use text labels with color, no emoji circles
// Icons from Lucide with animations for active states
const getTaskStatusBadge = (status: Message['taskStatus']) => {
  if (!status) return null;
  switch (status) {
    case 'pending':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-success/15 text-chatroom-status-success`,
        label: 'pending',
        icon: <Clock size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'in_progress':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: 'in progress',
        icon: <Loader2 size={ICON_SIZE} className="flex-shrink-0 animate-spin" />,
      };
    case 'queued':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`,
        label: 'queued',
        icon: <Timer size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'completed':
      return {
        className: `${BADGE_BASE} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'done',
        icon: <CheckCircle2 size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'cancelled':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-error/15 text-chatroom-status-error`,
        label: 'cancelled',
        icon: <XCircle size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'backlog':
      return {
        className: `${BADGE_BASE} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'backlog',
        icon: <Archive size={ICON_SIZE} className="flex-shrink-0" />,
      };
    default:
      return null;
  }
};

// Classification badge styling - with icons for visual consistency
const getClassificationBadge = (classification: Message['classification']) => {
  if (!classification) return null;
  switch (classification) {
    case 'question':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: 'question',
        icon: <HelpCircle size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'new_feature':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`,
        label: 'new feature',
        icon: <Sparkles size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'follow_up':
      return {
        className: `${BADGE_BASE} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'follow-up',
        icon: <RotateCcw size={ICON_SIZE} className="flex-shrink-0" />,
      };
    default:
      return null;
  }
};

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);
  const messageTypeBadge = getMessageTypeBadge(message.type);

  // Only show status badge for active tasks (in_progress), not for done/completed
  const isActiveTask =
    message.taskStatus === 'pending' ||
    message.taskStatus === 'in_progress' ||
    message.taskStatus === 'queued';
  const showStatusBadge =
    message.senderRole.toLowerCase() === 'user' && taskStatusBadge && isActiveTask;

  return (
    <div className="px-4 py-3 bg-transparent border-b-2 border-chatroom-border transition-all duration-100 hover:bg-chatroom-accent-subtle hover:-mx-2 hover:px-6 last:border-b-0">
      {/* Message Header - badges left, sender flow right */}
      <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-chatroom-border">
        {/* Left: Type and Classification badges */}
        <div className="flex items-center flex-wrap gap-y-1 gap-x-1.5">
          {messageTypeBadge && (
            <span className={messageTypeBadge.className}>
              {messageTypeBadge.icon}
              {messageTypeBadge.label}
            </span>
          )}
          {message.senderRole.toLowerCase() === 'user' && classificationBadge && (
            <span className={classificationBadge.className}>
              {classificationBadge.icon}
              {classificationBadge.label}
            </span>
          )}
        </div>
        {/* Right: Sender → Target */}
        <div className="flex items-center gap-x-1.5">
          <span className={getSenderClasses(message.senderRole)}>{message.senderRole}</span>
          {message.targetRole && (
            <>
              <ArrowRight size={10} className="text-chatroom-text-muted flex-shrink-0" />
              <span className="text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wide">
                {message.targetRole}
              </span>
            </>
          )}
        </div>
      </div>
      {/* Message Content */}
      <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words overflow-x-hidden prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-pre:overflow-x-auto prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-table:block prose-table:overflow-x-auto prose-table:w-fit prose-table:max-w-full prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
        <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
      </div>
      {/* Message Footer - status left, timestamp right */}
      <div className="flex justify-between items-center mt-2 pt-1.5">
        {/* Left: Status badge (only for active tasks) */}
        <div className="flex items-center gap-x-1.5">
          {showStatusBadge && (
            <span className={taskStatusBadge.className}>
              {taskStatusBadge.icon}
              {taskStatusBadge.label}
            </span>
          )}
        </div>
        {/* Right: Timestamp */}
        <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
          {formatTime(message._creationTime)}
        </span>
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

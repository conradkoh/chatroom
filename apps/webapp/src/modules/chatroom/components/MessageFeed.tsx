'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
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
import React, { useEffect, useRef, useMemo, memo, useCallback, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AttachedTaskDetailModal } from './AttachedTaskDetailModal';
import { FeatureDetailModal } from './FeatureDetailModal';
import { compactMarkdownComponents } from './markdown-utils';
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
  // Feature metadata (only for new_feature classification)
  featureTitle?: string;
  featureDescription?: string;
  featureTechSpecs?: string;
  // Attached backlog tasks for context
  attachedTasks?: AttachedTask[];
}

interface AttachedTask {
  _id: string;
  content: string;
  backlogStatus?: 'not_started' | 'started' | 'complete' | 'closed';
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
// User role gets special gold styling with subtle shimmer effect
const getSenderClasses = (role: string) => {
  const base = 'font-bold text-[10px] uppercase tracking-wide';
  if (role.toLowerCase() === 'user') {
    // Gold/amber color with text shadow for subtle glow effect
    return `${base} text-amber-500 dark:text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]`;
  }
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
};

// Check if user is involved in the message (as sender or target)
const isUserInvolved = (senderRole: string, targetRole?: string) => {
  return senderRole.toLowerCase() === 'user' || (targetRole && targetRole.toLowerCase() === 'user');
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

// Sticky Task Header - renders before user messages as a section header
// Shows shimmer while awaiting classification, then displays task title
interface TaskHeaderProps {
  message: Message;
}

const TaskHeader = memo(function TaskHeader({ message }: TaskHeaderProps) {
  // Only show for user messages
  if (message.senderRole.toLowerCase() !== 'user') {
    return null;
  }

  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);

  // Determine what to display:
  // - No taskId yet: shimmer (waiting for agent to pick up)
  // - Has taskId but no classification: shimmer (waiting for classification)
  // - Has classification + featureTitle: show first 2 lines of title
  // - Has classification but no featureTitle: show classification badge only
  const isAwaitingClassification = !message.classification;

  // Get display text - use featureTitle if available, otherwise first 2 lines of content
  const getDisplayText = () => {
    const text = message.featureTitle || message.content;
    const lines = text.split('\n').slice(0, 2);
    return lines.join('\n');
  };

  return (
    <div className="sticky top-0 z-10 px-3 py-2 bg-amber-50 dark:bg-amber-950 border-b-2 border-amber-200 dark:border-amber-800 shadow-sm">
      <div className="flex items-center gap-2">
        {/* Left: Classification badge or shimmer */}
        {isAwaitingClassification ? (
          // Shimmer state - waiting for classification
          <div className="flex items-center gap-2 flex-1">
            <div className="h-4 w-16 bg-amber-200/50 dark:bg-amber-700/50 animate-pulse rounded" />
            <div className="h-4 flex-1 max-w-xs bg-amber-100/50 dark:bg-amber-800/50 animate-pulse rounded" />
          </div>
        ) : (
          // Classified state - show badge and content
          <>
            {classificationBadge && (
              <span className={classificationBadge.className}>
                {classificationBadge.icon}
                {classificationBadge.label}
              </span>
            )}
            <span className="flex-1 text-sm font-medium text-amber-800 dark:text-amber-200 line-clamp-2 leading-tight">
              {getDisplayText()}
            </span>
          </>
        )}

        {/* Right: Status badge */}
        {taskStatusBadge && (
          <span className={taskStatusBadge.className}>
            {taskStatusBadge.icon}
            {taskStatusBadge.label}
          </span>
        )}
      </div>
    </div>
  );
});

interface MessageItemProps {
  message: Message;
  onFeatureClick?: (message: Message) => void;
  onAttachedTaskClick?: (task: AttachedTask) => void;
}

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({
  message,
  onFeatureClick,
  onAttachedTaskClick,
}: MessageItemProps) {
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

  // Check if this is a new_feature message with a title
  const hasFeatureTitle = message.classification === 'new_feature' && message.featureTitle;

  const handleFeatureTitleClick = useCallback(() => {
    if (hasFeatureTitle && onFeatureClick) {
      onFeatureClick(message);
    }
  }, [hasFeatureTitle, onFeatureClick, message]);

  // Determine if this message involves the user (for styling)
  const userInvolved = isUserInvolved(message.senderRole, message.targetRole);

  return (
    <div
      className={`px-4 py-3 border-b-2 border-chatroom-border transition-all duration-100 last:border-b-0 ${
        userInvolved
          ? // User-involved messages: subtle amber background
            'bg-amber-50/30 dark:bg-amber-950/20'
          : // Other messages: transparent, hover effect
            'bg-transparent hover:bg-chatroom-accent-subtle hover:-mx-2 hover:px-6'
      }`}
    >
      {/* Message Header - badges left, sender flow right */}
      {/* Lighter grey background when user is involved for visual emphasis */}
      <div
        className={`flex justify-between items-center mb-2 pb-1.5 border-b transition-colors ${
          userInvolved
            ? 'bg-gray-100/50 dark:bg-gray-700/30 -mx-4 px-4 py-1 border-amber-200/30 dark:border-amber-500/20'
            : 'border-chatroom-border'
        }`}
      >
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
        {/* Right: Sender → Target - User always rendered in gold */}
        <div className="flex items-center gap-x-1.5">
          <span className={getSenderClasses(message.senderRole)}>{message.senderRole}</span>
          {message.targetRole && (
            <>
              <ArrowRight size={10} className="text-chatroom-text-muted flex-shrink-0" />
              <span className={getSenderClasses(message.targetRole)}>{message.targetRole}</span>
            </>
          )}
        </div>
      </div>
      {/* Feature Title - clickable link for new_feature messages */}
      {hasFeatureTitle && (
        <button
          onClick={handleFeatureTitleClick}
          className="w-full text-left mb-2 px-3 py-2 bg-chatroom-status-warning/10 border border-chatroom-status-warning/20 hover:bg-chatroom-status-warning/20 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-chatroom-status-warning flex-shrink-0" />
            <span className="text-sm font-semibold text-chatroom-text-primary">
              {message.featureTitle}
            </span>
          </div>
          {(message.featureDescription || message.featureTechSpecs) && (
            <span className="text-[10px] text-chatroom-text-muted ml-5">Click to view details</span>
          )}
        </button>
      )}
      {/* Message Content */}
      <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words overflow-x-hidden prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-pre:overflow-x-auto prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-table:block prose-table:overflow-x-auto prose-table:w-fit prose-table:max-w-full prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
        <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
      </div>
      {/* Attached Backlog Tasks */}
      {message.attachedTasks && message.attachedTasks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-chatroom-border">
          <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted mb-2">
            Attached Backlog ({message.attachedTasks.length})
          </div>
          {message.attachedTasks.map((task) => (
            <button
              key={task._id}
              onClick={() => onAttachedTaskClick?.(task)}
              className="w-full text-left border-l-2 border-chatroom-accent bg-chatroom-bg-tertiary p-2 mb-2 last:mb-0 hover:bg-chatroom-accent-subtle transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
                  <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
                    {task.content}
                  </Markdown>
                </div>
                <span
                  className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    task.backlogStatus === 'started'
                      ? 'bg-chatroom-status-info/15 text-chatroom-status-info'
                      : task.backlogStatus === 'complete'
                        ? 'bg-chatroom-status-success/15 text-chatroom-status-success'
                        : 'bg-chatroom-text-muted/15 text-chatroom-text-muted'
                  }`}
                >
                  {task.backlogStatus || 'not started'}
                </span>
                <ChevronRight
                  size={14}
                  className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
                />
              </div>
            </button>
          ))}
        </div>
      )}
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

// State for feature detail modal
interface FeatureModalState {
  isOpen: boolean;
  title: string;
  description?: string;
  techSpecs?: string;
}

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

  // Feature detail modal state
  const [featureModal, setFeatureModal] = useState<FeatureModalState>({
    isOpen: false,
    title: '',
  });

  // Attached task detail modal state
  const [selectedAttachedTask, setSelectedAttachedTask] = useState<AttachedTask | null>(null);

  // Handle feature title click - open modal with details
  const handleFeatureClick = useCallback((message: Message) => {
    if (message.featureTitle) {
      setFeatureModal({
        isOpen: true,
        title: message.featureTitle,
        description: message.featureDescription,
        techSpecs: message.featureTechSpecs,
      });
    }
  }, []);

  // Close feature modal
  const handleCloseFeatureModal = useCallback(() => {
    setFeatureModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Handle attached task click - open read-only detail modal
  const handleAttachedTaskClick = useCallback((task: AttachedTask) => {
    setSelectedAttachedTask(task);
  }, []);

  // Close attached task modal
  const handleCloseAttachedTaskModal = useCallback(() => {
    setSelectedAttachedTask(null);
  }, []);

  // Filter out join messages and reverse to show oldest first (query returns newest first)
  const displayMessages = useMemo(() => {
    const filtered = (results || []).filter((m) => m.type !== 'join');
    // Reverse because paginated query returns newest first, but we want oldest at top
    return [...filtered].reverse();
  }, [results]);

  // Track if user is at bottom of scroll for auto-scroll behavior and floating button
  // Using state instead of ref so the floating button can react to changes
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Also keep a ref for the auto-scroll useEffect (avoids stale closure issues)
  const isAtBottomRef = useRef(true);

  // Threshold for considering user "at bottom" (in pixels)
  const AT_BOTTOM_THRESHOLD = 50;

  // Check if user is at bottom and update both state and ref
  const updateIsAtBottom = useCallback(() => {
    if (feedRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }
  }, []);

  // Scroll to bottom smoothly
  const scrollToBottom = useCallback(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({
        top: feedRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  // Maintain scroll position when loading older messages (paginating up)
  useEffect(() => {
    if (feedRef.current) {
      const newScrollHeight = feedRef.current.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeightRef.current;
      const messagesAdded = displayMessages.length > prevMessageCountRef.current;

      if (messagesAdded) {
        if (status === 'LoadingMore') {
          // Loading older messages (paginating up) - maintain scroll position
          // by adding the height difference to current scroll
          if (heightDiff > 0) {
            feedRef.current.scrollTop = feedRef.current.scrollTop + heightDiff;
          }
        } else if (isAtBottomRef.current) {
          // New message arrived and user was at bottom - scroll to bottom
          feedRef.current.scrollTop = feedRef.current.scrollHeight;
          // Ensure state is also updated
          setIsAtBottom(true);
        }
        // If user scrolled up (not at bottom), don't auto-scroll
      }

      prevScrollHeightRef.current = newScrollHeight;
    }
    prevMessageCountRef.current = displayMessages.length;
  }, [displayMessages.length, status]);

  // Handle scroll: load more when near top, track if at bottom
  const handleScroll = useCallback(() => {
    // Track if user is at bottom for auto-scroll behavior
    updateIsAtBottom();

    // Load more when user scrolls within threshold of top
    if (feedRef.current && status === 'CanLoadMore') {
      const { scrollTop } = feedRef.current;
      if (scrollTop < SCROLL_THRESHOLD) {
        loadMore(LOAD_MORE_SIZE);
      }
    }
  }, [status, loadMore, updateIsAtBottom]);

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
      {/* Scrollable message content - Task headers use CSS sticky to stay at top while scrolling */}
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
          <React.Fragment key={message._id}>
            {/* Task Header - sticky section header for user messages */}
            <TaskHeader message={message} />
            <MessageItem
              message={message}
              onFeatureClick={handleFeatureClick}
              onAttachedTaskClick={handleAttachedTaskClick}
            />
          </React.Fragment>
        ))}
      </div>
      {/* Working indicator - sticky at bottom, always visible */}
      <WorkingIndicator participants={participants} />
      {/* Scroll to bottom floating button - appears when user scrolls up */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent rounded-full shadow-lg hover:bg-chatroom-accent/90 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={16} />
          <span className="text-xs font-medium">New messages</span>
        </button>
      )}
      {/* Sticky message counter - always visible at bottom */}
      <div className="px-4 py-1 text-[10px] text-chatroom-text-muted text-right bg-chatroom-bg-primary border-t border-chatroom-border">
        {displayMessages.length} messages loaded
      </div>
      {/* Feature Detail Modal */}
      <FeatureDetailModal
        isOpen={featureModal.isOpen}
        onClose={handleCloseFeatureModal}
        title={featureModal.title}
        description={featureModal.description}
        techSpecs={featureModal.techSpecs}
      />
      {/* Attached Task Detail Modal */}
      <AttachedTaskDetailModal
        isOpen={selectedAttachedTask !== null}
        task={selectedAttachedTask}
        onClose={handleCloseAttachedTaskModal}
      />
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

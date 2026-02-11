'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Clock,
  Loader2,
  Timer,
  CheckCircle2,
  Check,
  XCircle,
  Archive,
  ArrowRightLeft,
  HelpCircle,
  Sparkles,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  memo,
  useCallback,
  useState,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AttachedArtifacts, type ArtifactMeta } from './ArtifactRenderer';
import { AttachedTaskDetailModal } from './AttachedTaskDetailModal';
import { FeatureDetailModal } from './FeatureDetailModal';
import {
  baseMarkdownComponents,
  compactMarkdownComponents,
  fullMarkdownComponents,
} from './markdown-utils';
import { MessageDetailModal } from './MessageDetailModal';
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
  // Attached artifacts
  attachedArtifacts?: ArtifactMeta[];
  // Latest progress message for inline display
  latestProgress?: {
    content: string;
    senderRole: string;
    _creationTime: number;
  };
}

interface AttachedTask {
  _id: string;
  content: string;
  backlogStatus?: TaskStatus;
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

// Map task status to display label and CSS classes for attached task badges
function getAttachedTaskStatusBadge(status?: TaskStatus): { label: string; classes: string } {
  switch (status) {
    case 'in_progress':
      return {
        label: 'In Progress',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'pending':
    case 'acknowledged':
    case 'backlog_acknowledged':
      return {
        label: status === 'pending' ? 'Pending' : 'Acknowledged',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'queued':
      return {
        label: 'Queued',
        classes: 'bg-chatroom-status-warning/15 text-chatroom-status-warning',
      };
    case 'pending_user_review':
      return {
        label: 'Pending Review',
        classes: 'bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400',
      };
    case 'completed':
      return {
        label: 'Completed',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'closed':
      return {
        label: 'Closed',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'backlog':
    default:
      return {
        label: 'Not Started',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
}

// Format relative time for progress timeline
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Sticky Task Header - renders before user messages as a section header
// Shows shimmer while awaiting classification, then displays task title
// Includes inline progress display (latest progress from denormalized task field)
// Tappable to show full message details in a slide-in modal
interface TaskHeaderProps {
  message: Message;
  chatroomId: string;
  onTap?: (message: Message) => void;
}

const TaskHeader = memo(function TaskHeader({
  message,
  chatroomId: _chatroomId,
  onTap,
}: TaskHeaderProps) {
  // useCallback must be called before any conditional returns (React hooks rules)
  const handleClick = useCallback(() => {
    if (onTap) {
      onTap(message);
    }
  }, [onTap, message]);

  // Only show for user messages
  if (message.senderRole.toLowerCase() !== 'user') {
    return null;
  }

  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);
  // Show progress if we have any latestProgress data (not just when in_progress)
  const hasProgress = !!message.latestProgress;
  // Track if task is actively in progress for animations
  const isTaskActive = message.taskStatus === 'in_progress';

  // Determine what to display:
  // - No classification yet AND task not finished: shimmer (waiting for classification)
  // - Has classification OR task is finished: show badge and single-line truncated title
  // Note: Completed/cancelled tasks should never show shimmer even if classification is missing
  const isTaskFinished = message.taskStatus === 'completed' || message.taskStatus === 'cancelled';
  const isAwaitingClassification = !message.classification && !isTaskFinished;

  // Get display text - use featureTitle if available, otherwise first line of content
  // Truncated to single line for uniform header height
  const getDisplayText = () => {
    const text = message.featureTitle || message.content;
    // Replace newlines with spaces for single-line display
    return text.replace(/\n+/g, ' ').trim();
  };

  // Check if progress is "fresh" (within last 30 seconds) for pulse animation
  // Only animate if task is still active
  const isProgressFresh =
    hasProgress && isTaskActive && Date.now() - message.latestProgress!._creationTime < 30000;

  // Dynamic height: h-8 when no progress, auto when progress is shown
  // Modern design: neutral grey background with colorized elements
  return (
    <div className="sticky top-0 z-10 w-full bg-chatroom-bg-tertiary border-b-2 border-chatroom-border-strong backdrop-blur-sm">
      {/* Main header row - clickable */}
      <button
        onClick={handleClick}
        className="w-full text-left h-8 px-3 flex items-center cursor-pointer hover:bg-chatroom-bg-hover transition-colors"
      >
        <div className="flex items-center gap-2 w-full min-w-0">
          {/* Left: Classification badge or shimmer */}
          {isAwaitingClassification ? (
            // Shimmer state - waiting for classification
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="h-4 w-16 bg-chatroom-border animate-pulse flex-shrink-0" />
              <div className="h-4 flex-1 max-w-xs bg-chatroom-border/50 animate-pulse" />
            </div>
          ) : (
            // Classified state - show badge and single-line truncated content
            <>
              {classificationBadge && (
                <span className={`${classificationBadge.className} flex-shrink-0`}>
                  {classificationBadge.icon}
                  {classificationBadge.label}
                </span>
              )}
              <span className="flex-1 min-w-0 text-xs font-medium text-chatroom-text-primary truncate">
                {getDisplayText()}
              </span>
            </>
          )}

          {/* Right: Status badge */}
          {taskStatusBadge && (
            <span className={`${taskStatusBadge.className} flex-shrink-0`}>
              {taskStatusBadge.icon}
              {taskStatusBadge.label}
            </span>
          )}
        </div>
      </button>

      {/* Inline progress row - shows latest progress from denormalized task field */}
      {hasProgress && (
        <div className="w-full text-left px-3 py-1.5 flex items-center gap-2 border-t border-chatroom-border/50">
          {isTaskActive ? (
            <Loader2
              size={12}
              className={`flex-shrink-0 text-chatroom-status-info ${isProgressFresh ? 'animate-spin' : ''}`}
            />
          ) : (
            <Check size={12} className="flex-shrink-0 text-chatroom-status-success" />
          )}
          <span
            className={`text-[11px] text-chatroom-text-secondary truncate flex-1 ${isProgressFresh ? 'animate-pulse' : ''}`}
          >
            {message.latestProgress!.content}
          </span>
          <span className="text-[9px] text-chatroom-text-muted flex-shrink-0">
            {formatRelativeTime(message.latestProgress!._creationTime)}
          </span>
        </div>
      )}
    </div>
  );
});

interface MessageItemProps {
  message: Message;
  onFeatureClick?: (message: Message) => void;
  onAttachedTaskClick?: (task: AttachedTask) => void;
  onMessageContentClick?: (message: Message) => void;
}

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({
  message,
  onFeatureClick,
  onAttachedTaskClick,
  onMessageContentClick,
}: MessageItemProps) {
  const messageTypeBadge = getMessageTypeBadge(message.type);

  // Check if this is a new_feature message with a title
  const hasFeatureTitle = message.classification === 'new_feature' && message.featureTitle;

  const handleFeatureTitleClick = useCallback(() => {
    if (hasFeatureTitle && onFeatureClick) {
      onFeatureClick(message);
    }
  }, [hasFeatureTitle, onFeatureClick, message]);

  // Handle message content click for user messages
  const handleContentClick = useCallback(() => {
    if (message.senderRole.toLowerCase() === 'user' && onMessageContentClick) {
      onMessageContentClick(message);
    }
  }, [message, onMessageContentClick]);

  // Check if this is a user message (for truncation and duplicate removal)
  const isUserMessage = message.senderRole.toLowerCase() === 'user';

  return (
    <div className="px-4 py-3 border-b-2 border-chatroom-border transition-all duration-100 last:border-b-0 bg-transparent hover:bg-chatroom-accent-subtle">
      {/* Message Header - only show for non-user messages (user message info is in TaskHeader) */}
      {!isUserMessage && (
        <div className="flex justify-between items-center mb-2 pb-1.5 border-b transition-colors border-chatroom-border">
          {/* Left: Type badge */}
          <div className="flex items-center flex-wrap gap-y-1 gap-x-1.5">
            {messageTypeBadge && (
              <span className={messageTypeBadge.className}>
                {messageTypeBadge.icon}
                {messageTypeBadge.label}
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
      )}
      {/* Feature Title - clickable link for new_feature messages (legacy support, kept for non-user messages) */}
      {!isUserMessage && hasFeatureTitle && (
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
      {/* Message Content - truncated for user messages, full for others */}
      {isUserMessage ? (
        <button
          onClick={handleContentClick}
          className="w-full text-left cursor-pointer hover:bg-chatroom-accent-subtle transition-colors -mx-2 px-2 py-1 rounded"
        >
          <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words overflow-hidden line-clamp-2 prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:my-0 prose-p:my-0 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:hidden prose-a:text-chatroom-status-info prose-a:underline prose-a:decoration-chatroom-status-info/50 prose-table:hidden prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0">
            <Markdown remarkPlugins={[remarkGfm]} components={baseMarkdownComponents}>
              {message.content}
            </Markdown>
          </div>
          <span className="text-[10px] text-chatroom-text-muted mt-1 block">Tap to expand</span>
        </button>
      ) : (
        <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words overflow-x-hidden prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:underline prose-a:decoration-chatroom-status-info/50 hover:prose-a:decoration-chatroom-status-info prose-table:border-collapse prose-table:block prose-table:overflow-x-auto prose-table:w-fit prose-table:max-w-full prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
          <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
            {message.content}
          </Markdown>
        </div>
      )}
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
                  className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${getAttachedTaskStatusBadge(task.backlogStatus).classes}`}
                >
                  {getAttachedTaskStatusBadge(task.backlogStatus).label}
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
      {/* Attached Artifacts */}
      {message.attachedArtifacts && message.attachedArtifacts.length > 0 && (
        <AttachedArtifacts artifacts={message.attachedArtifacts} />
      )}
      {/* Message Footer - only show timestamp for non-user messages (user message status/time in TaskHeader) */}
      {!isUserMessage && (
        <div className="flex justify-end items-center mt-2 pt-1.5">
          {/* Right: Timestamp */}
          <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
            {formatTime(message._creationTime)}
          </span>
        </div>
      )}
    </div>
  );
});

// Number of messages to load initially and per page
// Initial size is larger to ensure enough messages fill the viewport on first load.
// Since join/progress messages are no longer in the feed, all fetched messages are displayable.
const INITIAL_PAGE_SIZE = 15;
const LOAD_MORE_SIZE = 15;
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

  // Message detail modal state (for TaskHeader tap and message content tap)
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

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

  // Handle TaskHeader tap or message content tap - open message detail modal
  const handleMessageDetailClick = useCallback((message: Message) => {
    setSelectedMessage(message);
  }, []);

  // Close message detail modal
  const handleCloseMessageDetailModal = useCallback(() => {
    setSelectedMessage(null);
  }, []);

  // Reverse to show oldest first
  // Join and progress messages are no longer created, so no client-side filtering needed.
  // Legacy join/progress messages may still exist but will be rare and harmless to display.
  const displayMessages = useMemo(() => {
    // Reverse because paginated query returns newest first, but we want oldest at top
    return [...(results || [])].reverse();
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

  // Track if we're in a loading more state to handle scroll position
  const wasLoadingMoreRef = useRef(false);

  // Update loading state ref when status changes
  useEffect(() => {
    wasLoadingMoreRef.current = status === 'LoadingMore';
  }, [status]);

  // CRITICAL: Use useLayoutEffect to adjust scroll position BEFORE browser paint
  // This prevents the visual "jump" when loading older messages
  useLayoutEffect(() => {
    if (feedRef.current) {
      const newScrollHeight = feedRef.current.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeightRef.current;
      const messagesAdded = displayMessages.length > prevMessageCountRef.current;

      if (messagesAdded && heightDiff > 0) {
        // Check if this was from loading older messages (content added at top)
        // We detect this by checking if prevScrollHeight was smaller (content was added)
        // and the user was near the top (likely paginating up)
        const wasNearTop = feedRef.current.scrollTop < 200;
        const contentAddedAtTop = wasLoadingMoreRef.current || wasNearTop;

        if (contentAddedAtTop) {
          // Loading older messages (paginating up) - maintain scroll position
          // by adding the height difference to current scroll position IMMEDIATELY
          // This happens synchronously before paint, so user sees no jump
          feedRef.current.scrollTop = feedRef.current.scrollTop + heightDiff;
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
  }, [displayMessages.length]);

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
      {/* Note: px-2 for horizontal padding, no vertical padding so sticky headers flush to top */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-2 min-h-0 scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
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
            {/* Task Header - sticky section header for user messages, tappable */}
            <TaskHeader
              message={message}
              chatroomId={chatroomId}
              onTap={handleMessageDetailClick}
            />
            <MessageItem
              message={message}
              onFeatureClick={handleFeatureClick}
              onAttachedTaskClick={handleAttachedTaskClick}
              onMessageContentClick={handleMessageDetailClick}
            />
          </React.Fragment>
        ))}
      </div>
      {/* Scroll to bottom floating button - appears when user scrolls up */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent rounded-full shadow-lg hover:bg-chatroom-accent/90 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={16} />
          <span className="text-xs font-medium">New messages</span>
        </button>
      )}
      {/* Status bar - fixed at bottom with working indicator (left) + message count (right) */}
      <div className="flex items-center justify-between px-4 py-2 bg-chatroom-bg-surface border-t-2 border-chatroom-border-strong">
        {/* Left: Working indicator (compact) - empty div maintains layout when no active agents */}
        <div className="flex-shrink-0">
          <WorkingIndicator participants={participants} compact />
        </div>
        {/* Right: Message count */}
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted tabular-nums">
          {displayMessages.length} messages
        </span>
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
      {/* Message Detail Modal - for TaskHeader and message content taps */}
      <MessageDetailModal
        isOpen={selectedMessage !== null}
        message={selectedMessage}
        onClose={handleCloseMessageDetailModal}
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

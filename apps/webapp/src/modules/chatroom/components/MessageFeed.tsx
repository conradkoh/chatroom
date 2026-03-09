'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
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
  HelpCircle,
  Sparkles,
  RotateCcw,
  ArrowRight,
  ArrowUp,
  Activity,
  Trash2,
  Pencil,
  Check,
  Copy,
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
import remarkBreaks from 'remark-breaks';

import { AttachedArtifacts, type ArtifactMeta } from './ArtifactRenderer';
import { AttachedTaskDetailModal } from './AttachedTaskDetailModal';
import { FeatureDetailModal } from './FeatureDetailModal';
import { compactMarkdownComponents, fullMarkdownComponents } from './markdown-utils';
import { MessageDetailModal } from './MessageDetailModal';
import { WorkingIndicator } from './WorkingIndicator';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSessionPaginatedQuery } from '@/lib/useSessionPaginatedQuery';

// Stable reference for remarkPlugins — avoids re-allocation on every render
// which would cause react-markdown to re-parse the AST unnecessarily
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

interface MessageFeedProps {
  chatroomId: string;
  activeTask?: { status: string; assignedTo?: string } | null;
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
  taskStatus?: 'pending' | 'in_progress' | 'backlog' | 'completed' | 'cancelled';
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
  // Queued message flag (from chatroom_messageQueue)
  isQueued?: boolean;
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

// Shared message content classes - used in MessageContent and QueuedMessageCard modal
const MESSAGE_CONTENT_CLASSES =
  'text-chatroom-text-primary text-[13px] leading-relaxed break-words overflow-x-hidden prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:underline prose-a:decoration-chatroom-status-info/50 hover:prose-a:decoration-chatroom-status-info prose-table:border-collapse prose-table:block prose-table:overflow-x-auto prose-table:w-fit prose-table:max-w-full prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary';

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

// Task Header - renders before user messages as a section header
// Shows shimmer while awaiting classification, then displays task title
// Tappable to show full message details in a slide-in modal
interface TaskHeaderProps {
  message: Message;
  onTap?: (message: Message) => void;
}

const TaskHeader = memo(function TaskHeader({ message, onTap }: TaskHeaderProps) {
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

  // Never render TaskHeader for queued messages
  if (message.isQueued) {
    return null;
  }

  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);

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

  return (
    <div className="w-full bg-chatroom-bg-tertiary border-b-2 border-chatroom-border-strong">
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
    </div>
  );
});

// Task Progress - renders inline progress updates below the task header
// Shows the latest progress message with expand/collapse for full history
interface TaskProgressProps {
  message: Message;
  chatroomId: string;
}

const TaskProgress = memo(function TaskProgress({ message, chatroomId }: TaskProgressProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-hide when focus is lost (click outside)
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    // Use setTimeout to avoid the click that opened it from immediately closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  // Only render for user messages
  if (message.senderRole.toLowerCase() !== 'user') {
    return null;
  }

  const hasProgress = !!message.latestProgress;

  const toggleExpanded = () => {
    if (hasProgress) {
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative bg-chatroom-bg-tertiary/50 border-b border-chatroom-border"
    >
      {hasProgress ? (
        <>
          {/* Collapsed: latest progress */}
          <button
            onClick={toggleExpanded}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-chatroom-bg-hover transition-colors"
          >
            <Activity size={12} className="text-chatroom-accent flex-shrink-0" />
            <span className="text-[11px] text-chatroom-text-muted truncate flex-1">
              {message.latestProgress!.content.replace(/\n+/g, ' ').trim()}
            </span>
            <span className="text-[10px] text-chatroom-text-muted/60 flex-shrink-0">
              {formatTime(message.latestProgress!._creationTime)}
            </span>
            {isExpanded ? (
              <ChevronUp size={12} className="text-chatroom-text-muted flex-shrink-0" />
            ) : (
              <ChevronDown size={12} className="text-chatroom-text-muted flex-shrink-0" />
            )}
          </button>

          {/* Expanded: full progress history - overlays as a floating panel */}
          {isExpanded && (
            <div className="absolute left-0 right-0 top-full z-20 shadow-lg border border-chatroom-border rounded-b-md bg-chatroom-bg-tertiary">
              <TaskProgressHistory chatroomId={chatroomId} taskId={message.taskId} />
            </div>
          )}
        </>
      ) : (
        /* Empty state: task is active but no progress reported yet */
        <div className="px-3 py-1.5 flex items-center gap-2">
          <Activity size={12} className="text-chatroom-text-muted/40 flex-shrink-0" />
          <span className="text-[11px] text-chatroom-text-muted/40 italic">
            No progress reported yet
          </span>
        </div>
      )}
    </div>
  );
});

// Full progress history - loaded on demand when expanded
const TaskProgressHistory = memo(function TaskProgressHistory({
  chatroomId,
  taskId,
}: {
  chatroomId: string;
  taskId?: string;
}) {
  const progressMessages = useSessionQuery(
    api.messages.getProgressForTask,
    taskId
      ? {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          taskId: taskId as Id<'chatroom_tasks'>,
        }
      : 'skip'
  );

  if (!progressMessages || progressMessages.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-chatroom-text-muted/60">
        No progress updates yet.
      </div>
    );
  }

  return (
    <div className="px-3 py-2 max-h-48 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-chatroom-border">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {progressMessages.map(
          (progress: {
            _id: string;
            content: string;
            senderRole: string;
            _creationTime: number;
          }) => (
            <React.Fragment key={progress._id}>
              <span className="text-[10px] text-chatroom-text-muted flex-shrink-0 tabular-nums whitespace-nowrap">
                {formatTime(progress._creationTime)}
              </span>
              <span className="text-[11px] text-chatroom-text-primary leading-snug">
                {progress.content}
              </span>
            </React.Fragment>
          )
        )}
      </div>
    </div>
  );
});

// ─── Queued Message Utilities ──────────────────────────────────────────────────
// Helpers shared by QueuedMessageCard.

/** Returns a human-readable elapsed time string that updates every second. */
function useElapsedTime(creationTime: number): string {
  const [elapsed, setElapsed] = useState(() => formatElapsed(creationTime));

  useEffect(() => {
    const update = () => setElapsed(formatElapsed(creationTime));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [creationTime]);

  return elapsed;
}

function formatElapsed(creationTime: number): string {
  const diffMs = Date.now() - creationTime;
  const totalSecs = Math.floor(diffMs / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

// ─── DeleteConfirmPopoverContent ──────────────────────────────────────────────
// Shared popover body for delete confirmation dialogs.
// Used by both the card icon-only button and the modal footer text button.

interface DeleteConfirmPopoverContentProps {
  onCancel: () => void;
  onConfirmDelete: () => void;
}

function DeleteConfirmPopoverContent({ onCancel, onConfirmDelete }: DeleteConfirmPopoverContentProps) {
  return (
    <>
      <div className="border-b-2 border-border px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">Delete Message</p>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground mb-3">
          This message will be permanently removed from the queue.
        </p>
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirmDelete}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </>
  );
}

// ─── QueuedMessageCard ────────────────────────────────────────────────────────
// Compact fixed-height card for each queued message.
// Row 1: truncated content (2 lines, clickable) | QUEUED badge | [↑] [🗑]
// Row 2: right-aligned timestamp + elapsed time
// Clicking the content area opens a modal with the full message.

interface QueuedMessageCardProps {
  message: Message;
  onPromote: (queuedMessageId: string) => Promise<void>;
  onDelete: (queuedMessageId: string) => Promise<void>;
  onEdit: (queuedMessageId: string, newContent: string) => Promise<void>;
}

const QueuedMessageCard = memo(function QueuedMessageCard({
  message,
  onPromote,
  onDelete,
  onEdit,
}: QueuedMessageCardProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Popover open states for delete confirmation (card and modal are independent)
  const [isCardDeletePopoverOpen, setIsCardDeletePopoverOpen] = useState(false);
  const [isModalDeletePopoverOpen, setIsModalDeletePopoverOpen] = useState(false);
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const formattedTime = new Date(message._creationTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handlePromote = useCallback(async () => {
    if (isPromoting || isDeleting) return;
    setIsPromoting(true);
    try {
      await onPromote(message._id);
    } finally {
      setIsPromoting(false);
    }
  }, [message._id, onPromote, isPromoting, isDeleting]);

  // Card delete — called from card popover "Delete" button
  const handleCardDelete = useCallback(async () => {
    if (isDeleting || isPromoting) return;
    setIsCardDeletePopoverOpen(false);
    setIsDeleting(true);
    try {
      await onDelete(message._id);
    } finally {
      setIsDeleting(false);
    }
  }, [message._id, onDelete, isDeleting, isPromoting]);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setIsModalDeletePopoverOpen(false);
  }, []);

  // Promote and close modal on success
  const handlePromoteAndClose = useCallback(async () => {
    if (isPromoting || isDeleting) return;
    setIsPromoting(true);
    try {
      await onPromote(message._id);
      setIsModalOpen(false);
    } finally {
      setIsPromoting(false);
    }
  }, [message._id, onPromote, isPromoting, isDeleting]);

  // Modal delete — called from modal popover "Delete" button
  const handleModalDelete = useCallback(async () => {
    if (isDeleting || isPromoting) return;
    setIsModalDeletePopoverOpen(false);
    setIsDeleting(true);
    try {
      await onDelete(message._id);
      setIsModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }, [message._id, onDelete, isDeleting, isPromoting]);

  // Edit handlers
  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setEditError(null);
    setIsEditing(true);
  }, [message.content]);

  const handleSaveEdit = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setEditError(null);
    try {
      await onEdit(message._id, editContent);
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [message._id, editContent, onEdit, isSaving]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditError(null);
  }, []);

  return (
    <>
      <div className="px-3 py-2 bg-card border-b border-border">
        {/* Row 1: truncated content | QUEUED badge | action buttons */}
        <div className="flex items-start gap-2">
          {/* Message content — truncated 2 lines, compact markdown, clickable */}
          <button
            onClick={handleOpenModal}
            className="flex-1 text-left text-sm line-clamp-2 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <Markdown remarkPlugins={REMARK_PLUGINS} components={compactMarkdownComponents}>
              {message.content}
            </Markdown>
          </button>

          {/* QUEUED badge removed — section header above container communicates queue status */}

          {/* Promote button — icon only */}
          <button
            onClick={handlePromote}
            disabled={isPromoting || isDeleting}
            className="flex-shrink-0 flex items-center justify-center w-6 h-6 bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Promote to active (bypass queue)"
          >
            {isPromoting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ArrowUp size={12} />
            )}
          </button>

          {/* Delete button — icon only, with popover confirmation */}
          <Popover open={isCardDeletePopoverOpen} onOpenChange={setIsCardDeletePopoverOpen}>
            <PopoverTrigger asChild>
              <button
                disabled={isDeleting || isPromoting}
                className="flex-shrink-0 flex items-center justify-center w-6 h-6 border border-border text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Delete queued message"
              >
                {isDeleting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0 rounded-none" side="top" align="end">
              <DeleteConfirmPopoverContent
                onCancel={() => setIsCardDeletePopoverOpen(false)}
                onConfirmDelete={handleCardDelete}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Row 2: right-aligned timestamp + elapsed time */}
        <div className="flex justify-end gap-2 mt-0.5 text-[10px] text-muted-foreground tabular-nums">
          <span>
            {formattedTime} ({elapsed})
          </span>
        </div>
      </div>

      {/* Full message modal */}
      <FixedModal isOpen={isModalOpen} onClose={handleCloseModal} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={handleCloseModal}>
            <FixedModalTitle>
              <span className="flex items-center gap-2">
                <Timer size={14} className="text-muted-foreground" />
                Queued Message
              </span>
            </FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody>
            {isEditing ? (
              <div className="p-6 flex flex-col gap-3">
                <textarea
                  className="w-full min-h-[120px] p-3 text-sm bg-background border border-border resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  autoFocus
                />
                {editError && (
                  <p className="text-xs text-red-500 dark:text-red-400">{editError}</p>
                )}
              </div>
            ) : (
              <div className="p-6">
                <div className={MESSAGE_CONTENT_CLASSES}>
                  <Markdown remarkPlugins={REMARK_PLUGINS} components={fullMarkdownComponents}>
                    {message.content}
                  </Markdown>
                </div>
              </div>
            )}
          </FixedModalBody>
          {/* Mobile-friendly footer with action buttons */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface">
            {/* Left: QUEUED status + elapsed time */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wide bg-orange-500/20 text-orange-600 dark:text-orange-400">
                <Timer size={12} className="flex-shrink-0" />
                Queued
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {elapsed}
              </span>
            </div>
            {/* Right: action buttons (larger, thumb-friendly for mobile) */}
            {isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editContent.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-4 py-2 border border-border text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePromoteAndClose}
                disabled={isPromoting || isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                title="Promote to active"
              >
                {isPromoting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowUp size={14} />
                )}
                Promote
              </button>
              {/* Modal delete button with popover confirmation */}
              <Popover open={isModalDeletePopoverOpen} onOpenChange={setIsModalDeletePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    disabled={isDeleting || isPromoting}
                    className="flex items-center gap-2 px-4 py-2 border border-border text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    title="Delete queued message"
                  >
                    {isDeleting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Delete
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0 rounded-none" side="top" align="end">
                  <DeleteConfirmPopoverContent
                    onCancel={() => setIsModalDeletePopoverOpen(false)}
                    onConfirmDelete={handleModalDelete}
                  />
                </PopoverContent>
              </Popover>
              {/* Edit button */}
              <button
                onClick={handleStartEdit}
                disabled={isPromoting || isDeleting}
                className="flex items-center gap-2 px-4 py-2 border border-border text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                title="Edit queued message"
              >
                <Pencil size={14} />
                Edit
              </button>
            </div>
            )}
          </div>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});

/** Small copy-to-clipboard button with brief check-mark feedback. */
const CopyMarkdownButton = memo(function CopyMarkdownButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [content]
  );

  return (
    <button
      onClick={handleCopy}
      className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
      title="Copy as markdown"
    >
      {copied ? (
        <Check size={12} className="text-chatroom-status-success" />
      ) : (
        <Copy size={12} />
      )}
    </button>
  );
});

interface MessageItemProps {
  message: Message;
  onFeatureClick?: (message: Message) => void;
  onAttachedTaskClick?: (task: AttachedTask) => void;
}

// System notification message (e.g. context change)
// Clickable to expand/collapse, shows markdown content when expanded
const SystemMessage = memo(function SystemMessage({ message }: { message: Message }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return (
    <>
      <div className="sticky top-0 z-10 bg-chatroom-bg-primary border-b border-chatroom-border backdrop-blur-sm px-4 py-3">
        {/* Clickable divider row - opens modal */}
        <button
          onClick={handleOpen}
          className="w-full flex items-center gap-3 group cursor-pointer"
        >
          <div className="flex-1 h-px bg-chatroom-status-info/30" />
          <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info bg-chatroom-status-info/10 border border-chatroom-status-info/30 group-hover:bg-chatroom-status-info/20 transition-colors min-w-0 overflow-hidden">
            <Sparkles size={10} className="flex-shrink-0" />
            <span className="flex-shrink-0">New Context</span>
            <span className="text-chatroom-status-info/50 flex-shrink-0">—</span>
            <span className="normal-case font-medium tracking-normal flex-1 min-w-0 truncate text-chatroom-text-secondary [&_*]:inline">
              <Markdown remarkPlugins={REMARK_PLUGINS} components={compactMarkdownComponents}>
                {message.content}
              </Markdown>
            </span>
          </div>
          <div className="flex-1 h-px bg-chatroom-status-info/30" />
        </button>
      </div>

      {/* Context detail modal */}
      <FixedModal isOpen={isModalOpen} onClose={handleClose} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={handleClose}>
            <FixedModalTitle>
              <span className="flex items-center gap-2">
                <Sparkles size={14} className="text-chatroom-status-info" />
                New Context
              </span>
            </FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody>
            <div className="p-6">
              <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-a:text-chatroom-status-info prose-a:underline prose-a:decoration-chatroom-status-info/50 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-secondary prose-blockquote:text-chatroom-text-secondary">
                <Markdown remarkPlugins={REMARK_PLUGINS} components={fullMarkdownComponents}>
                  {message.content}
                </Markdown>
              </div>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});

// Shared message content renderer with Markdown support

const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  return (
    <div className={MESSAGE_CONTENT_CLASSES}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={fullMarkdownComponents}>
        {content}
      </Markdown>
    </div>
  );
});

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({
  message,
  onFeatureClick,
  onAttachedTaskClick,
}: MessageItemProps) {
  // Check if this is a new_feature message with a title
  const hasFeatureTitle = message.classification === 'new_feature' && message.featureTitle;

  const handleFeatureTitleClick = useCallback(() => {
    if (hasFeatureTitle && onFeatureClick) {
      onFeatureClick(message);
    }
  }, [hasFeatureTitle, onFeatureClick, message]);

  // Render new-context messages as sticky visual dividers (after all hooks)
  if (message.type === 'new-context') {
    return <SystemMessage message={message} />;
  }

  const messageTypeBadge = getMessageTypeBadge(message.type);

  // Check if this is a user message (for truncation and duplicate removal)
  const isUserMessage = message.senderRole.toLowerCase() === 'user';

  return (
    <div className="group/msg px-4 py-3 border-b-2 border-chatroom-border last:border-b-0 bg-transparent">
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
      {/* Message Content */}
      {/* Message Content - unified renderer for all message types */}
      <MessageContent content={message.content} />
      {/* Attached Backlog Tasks */}
      {message.attachedTasks && message.attachedTasks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-chatroom-border">
          <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted mb-2">
            Attached Backlog ({message.attachedTasks.length})
          </div>
          {message.attachedTasks.map((task) => {
            const statusBadge = getAttachedTaskStatusBadge(task.backlogStatus);
            return (
              <button
                key={task._id}
                onClick={() => onAttachedTaskClick?.(task)}
                className="w-full text-left border-l-2 border-chatroom-accent bg-chatroom-bg-tertiary p-2 mb-2 last:mb-0 hover:bg-chatroom-accent-subtle transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
                    <Markdown remarkPlugins={REMARK_PLUGINS} components={compactMarkdownComponents}>
                      {task.content}
                    </Markdown>
                  </div>
                  <span
                    className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusBadge.classes}`}
                  >
                    {statusBadge.label}
                  </span>
                  <ChevronRight
                    size={14}
                    className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
      {/* Attached Artifacts */}
      {message.attachedArtifacts && message.attachedArtifacts.length > 0 && (
        <AttachedArtifacts artifacts={message.attachedArtifacts} />
      )}
      {/* Message Footer */}
      <div className="flex justify-between items-center mt-2 pt-1.5">
        {/* Left: Copy button — appears on hover */}
        <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <CopyMarkdownButton content={message.content} />
        </div>
        {/* Right: Timestamp (non-user messages only; user message status/time is in TaskHeader) */}
        {!isUserMessage && (
          <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
            {formatTime(message._creationTime)}
          </span>
        )}
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

export const MessageFeed = memo(function MessageFeed({ chatroomId, activeTask }: MessageFeedProps) {
  const { results, status, loadMore, isLoading } = useSessionPaginatedQuery(
    api.messages.listPaginated,
    { chatroomId: chatroomId as Id<'chatroom_rooms'> },
    { initialNumItems: INITIAL_PAGE_SIZE }
  ) as {
    results: Message[];
    status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
    isLoading: boolean;
    loadMore: (numItems: number) => void;
  };

  // Fetch queued messages (from chatroom_messageQueue)
  const queuedMessages = useSessionQuery(api.messages.listQueued, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const displayQueuedMessages = useMemo(() => {
    return queuedMessages ?? [];
  }, [queuedMessages]);

  // Mutations for queued message controls
  const promoteSpecificTask = useSessionMutation(api.tasks.promoteSpecificTask);
  const deleteQueuedMessage = useSessionMutation(api.messages.deleteQueuedMessage);
  const updateQueuedMessage = useSessionMutation(api.messages.updateQueuedMessage);

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

  // Queue list modal state (shows all queued messages when "+ N more" row is clicked)
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);

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

  // Handle queued message Promote — calls promoteSpecificTask mutation
  const handleQueuedPromote = useCallback(
    async (queuedMessageId: string) => {
      try {
        await promoteSpecificTask({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to promote queued message:', error);
      }
    },
    [promoteSpecificTask]
  );

  // Handle queued message Delete — removes the queue record directly
  const handleQueuedDelete = useCallback(
    async (queuedMessageId: string) => {
      try {
        await deleteQueuedMessage({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        // Silently ignore if the record no longer exists (already promoted or deleted)
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('not found') || msg.includes('Already deleted')) {
          return;
        }
        console.error('Failed to delete queued message:', error);
      }
    },
    [deleteQueuedMessage]
  );

  const handleQueuedEdit = useCallback(
    async (queuedMessageId: string, newContent: string) => {
      await updateQueuedMessage({
        queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        content: newContent,
      });
    },
    [updateQueuedMessage]
  );

  // Load more messages handler - stable reference for button onClick
  const handleLoadMore = useCallback(() => {
    loadMore(LOAD_MORE_SIZE);
  }, [loadMore]);

  // Reverse to show oldest first (backend already filters out join/progress messages)
  const displayMessages = useMemo(() => {
    // Reverse because paginated query returns newest first, we want oldest at top
    const regularMessages = [...(results || [])].reverse();
    return regularMessages; // Queued messages are shown separately (pinned at bottom)
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

  // Auto-load more messages when content doesn't fill the container.
  // This handles the edge case where initial messages are too few to create a scrollbar,
  // making it impossible for the user to scroll up to trigger loading.
  //
  // Loop safety: This progressively loads until either:
  // 1. Content fills the viewport (scrollHeight > clientHeight), or
  // 2. All data is loaded (status becomes 'Exhausted')
  // The status === 'CanLoadMore' guard prevents re-triggering during 'LoadingMore'.
  useEffect(() => {
    if (feedRef.current && status === 'CanLoadMore') {
      const { scrollHeight, clientHeight } = feedRef.current;
      // If content doesn't overflow (no scrollbar), auto-load more
      if (scrollHeight <= clientHeight) {
        loadMore(LOAD_MORE_SIZE);
      }
    }
  }, [status, loadMore, displayMessages.length]);

  // Auto-scroll to bottom when queue section appears or disappears (only if already at bottom)
  // This ensures the last message stays visible when the queue section grows/shrinks
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayQueuedMessages.length]);

  // Keep scroll pinned to bottom when the feed container resizes (e.g. multi-line
  // input growing/shrinking changes the available height for the message area)
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 min-h-0 scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
        ref={feedRef}
        onScroll={handleScroll}
      >
        {/* Load More indicator at top - clickable to load older messages */}
        {status === 'CanLoadMore' && (
          <button
            type="button"
            onClick={handleLoadMore}
            className="w-full py-2 mb-2 text-[10px] text-chatroom-text-muted flex items-center justify-center gap-1 hover:text-chatroom-text-primary transition-colors cursor-pointer"
          >
            <ChevronUp size={12} />
            Load older messages
          </button>
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
            <TaskHeader message={message} onTap={handleMessageDetailClick} />
            {/* Task Progress - inline progress updates below task header */}
            <TaskProgress message={message} chatroomId={chatroomId} />
            <MessageItem
              message={message}
              onFeatureClick={handleFeatureClick}
              onAttachedTaskClick={handleAttachedTaskClick}
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
      {/* Queued Messages - pinned just above status bar */}
      {/* Always rendered — animated to height 0 when empty, slides in when a message is queued */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          displayQueuedMessages.length > 0
            ? 'max-h-[600px] opacity-100'
            : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-border">
          {/* Section header */}
          <div className="px-3 pt-2 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
              Queued
            </p>
          </div>
          {/* Inset card — sharp corners, no rounded-md */}
          <div className="mx-3 mb-2 overflow-hidden border border-border shadow-sm">
            {/* First queued message card — conditionally rendered to avoid undefined message */}
            {displayQueuedMessages.length > 0 && (
              <QueuedMessageCard
                key={displayQueuedMessages[0]._id}
                message={displayQueuedMessages[0]}
                onPromote={handleQueuedPromote}
                onDelete={handleQueuedDelete}
                onEdit={handleQueuedEdit}
              />
            )}
            {/* "+ N more" row — only shown when there are additional queued messages */}
            {displayQueuedMessages.length > 1 && (
              <button
                onClick={() => setIsQueueModalOpen(true)}
                className="w-full flex items-center justify-between px-3 py-1.5 bg-card border-t border-border text-[10px] text-orange-600 dark:text-orange-400 hover:bg-accent/50 transition-colors"
              >
                <span>+ {displayQueuedMessages.length - 1} more in queue</span>
                <span className="font-bold uppercase tracking-wide">View all →</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Queue list modal — shows all queued messages */}
      <FixedModal isOpen={isQueueModalOpen} onClose={() => setIsQueueModalOpen(false)} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setIsQueueModalOpen(false)}>
            <FixedModalTitle>Queue ({displayQueuedMessages.length})</FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody>
            {displayQueuedMessages.map((message) => (
              <QueuedMessageCard
                key={message._id}
                message={message}
                onPromote={handleQueuedPromote}
                onDelete={handleQueuedDelete}
                onEdit={handleQueuedEdit}
              />
            ))}
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
      {/* Status bar - fixed at bottom with working indicator (left) + message count (right) */}
      <div className="flex items-center justify-between px-4 py-2 bg-chatroom-bg-surface border-t-2 border-chatroom-border-strong">
        {/* Left: Working indicator (compact) - empty div maintains layout when no active agents */}
        <div className="flex-shrink-0">
          <WorkingIndicator activeTask={activeTask} compact />
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

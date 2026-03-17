'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Plus,
  Trash2,
  X,
  Play,
  ChevronRight,
  ClipboardCheck,
  MoreHorizontal,
  XCircle,
} from 'lucide-react';
import React, { useState, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { BacklogCreateModal } from './BacklogCreateModal';
import { BacklogItemDetailModal } from './BacklogItemDetailModal';
import { baseMarkdownComponents, compactMarkdownComponents } from './markdown-utils';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQueueModal } from './TaskQueueModal';
import { type BacklogItem, getScoringBadge, getBacklogStatusBadge } from './backlog';

import type { TeamLifecycle } from '../types/readiness';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type TaskStatus = 'pending' | 'acknowledged' | 'in_progress' | 'completed';

type TaskOrigin = 'backlog' | 'chat';

type BacklogStatus = 'not_started' | 'started' | 'complete' | 'closed';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  origin?: TaskOrigin;
  createdAt: number;
  updatedAt: number;
  queuePosition: number;
  assignedTo?: string;
  backlog?: {
    status: BacklogStatus;
  };
  // Scoring fields for prioritization
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
  priority?: number;
}

interface TaskCounts {
  pending: number;
  acknowledged: number;
  in_progress: number;
  queued: number;
  backlog: number;
  pendingUserReview: number;
  completed: number;
}

interface WorkQueueProps {
  chatroomId: string;
  /** Lifecycle data from the parent — used to derive needsPromotion without a separate checkQueueHealth subscription */
  lifecycle?: TeamLifecycle | null;
}

// Status badge colors - using chatroom status variables for theme support
const getStatusBadge = (status: TaskStatus) => {
  switch (status) {
    case 'pending':
      return {
        emoji: '🟢',
        label: 'Pending',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'acknowledged':
      return {
        emoji: '🟢',
        label: 'Acknowledged',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'in_progress':
      return {
        emoji: '🔵',
        label: 'In Progress',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'completed':
      return {
        emoji: '✅',
        label: 'Completed',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    default:
      return {
        emoji: '⚫',
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

// Maximum number of pending review items to show in sidebar before "View More"
const PENDING_REVIEW_PREVIEW_LIMIT = 3;

// Maximum number of current tasks to show in sidebar before "View More"
const CURRENT_TASKS_PREVIEW_LIMIT = 3;

export function WorkQueue({ chatroomId, lifecycle }: WorkQueueProps) {
  const [isBacklogCreateModalOpen, setIsBacklogCreateModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [isPendingReviewModalOpen, setIsPendingReviewModalOpen] = useState(false);
  const [isCurrentTasksModalOpen, setIsCurrentTasksModalOpen] = useState(false);
  const [selectedBacklogItem, setSelectedBacklogItem] = useState<BacklogItem | null>(null);
  const [isBacklogQueueModalOpen, setIsBacklogQueueModalOpen] = useState(false);

  // Query tasks
  const tasks = useSessionQuery(api.tasks.listTasks, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'active',
    limit: 100, // Match MAX_TASK_LIST_LIMIT from backend
  }) as Task[] | undefined;

  // Query backlog items from the dedicated chatroom_backlog table
  // Only fetch items with status 'backlog' (excludes 'pending_user_review' items shown in the Pending Review section)
  const backlogItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'backlog',
    limit: 100,
  });
  const backlogItems = (backlogItemsRaw ?? []) as BacklogItem[];

  // Query task counts
  const counts = useSessionQuery(api.tasks.getTaskCounts, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TaskCounts | undefined;

  // Derive needsPromotion from counts and lifecycle (replaces checkQueueHealth subscription)
  // A promotion is needed when: no active task, there are queued tasks, and all agents are waiting
  const needsPromotion = useMemo(() => {
    if (!counts) return false;
    const hasActiveTask = counts.pending > 0 || counts.acknowledged > 0 || counts.in_progress > 0;
    const hasQueuedTasks = counts.queued > 0;
    if (!hasActiveTask && hasQueuedTasks) {
      // Check if all agents are waiting (lastSeenAction === 'get-next-task:started')
      const participants = lifecycle?.participants ?? [];
      const activeParticipants = participants.filter((p) => p.lastSeenAction !== 'exited');
      if (activeParticipants.length === 0) return true; // No active agents — allow promote
      const allWaiting = activeParticipants.every(
        (p) => p.lastSeenAction === 'get-next-task:started'
      );
      return allWaiting;
    }
    return false;
  }, [counts, lifecycle]);

  // Query pending review backlog items from the dedicated chatroom_backlog table
  const pendingReviewBacklogItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'pending_user_review',
    limit: 100,
  });
  const pendingReviewBacklogItems = (pendingReviewBacklogItemsRaw ?? []) as BacklogItem[];

  // Mutations
  const createBacklogItem = useSessionMutation(api.backlog.createBacklogItem);
  const promoteNextTask = useSessionMutation(api.tasks.promoteNextTask);
  const updateTask = useSessionMutation(api.tasks.updateTask);
  const completeTaskById = useSessionMutation(api.tasks.completeTaskById);
  // Note: cancelTask mutation was removed in Phase 3 backlog cleanup

  // Categorize tasks by status
  const categorizedTasks = useMemo(() => {
    // Sort backlog items by updatedAt descending (most recently updated first)
    const sortedBacklog = [...backlogItems].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      current: (tasks ?? []).filter(
        (t) => t.status === 'pending' || t.status === 'acknowledged' || t.status === 'in_progress'
      ),
      backlog: sortedBacklog,
    };
  }, [tasks, backlogItems]);

  // Handlers
  const handleAddTask = useCallback(
    async (content: string) => {
      await createBacklogItem({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        content,
        createdBy: 'user',
      });
    },
    [createBacklogItem, chatroomId]
  );

  const handlePromoteNext = useCallback(async () => {
    try {
      await promoteNextTask({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      });
    } catch (error) {
      console.error('Failed to promote next task:', error);
    }
  }, [promoteNextTask, chatroomId]);

  // Modal handlers
  const handleOpenTaskDetail = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  const handleCloseTaskDetail = useCallback(() => {
    setSelectedTask(null);
  }, []);

  const handleModalEdit = useCallback(
    async (taskId: string, content: string) => {
      try {
        await updateTask({
          taskId: taskId as Id<'chatroom_tasks'>,
          content,
        });
        // Update selectedTask with new content to reflect edit immediately
        setSelectedTask((prev) => (prev ? { ...prev, content } : null));
      } catch (error) {
        console.error('Failed to update task:', error);
        throw error; // Re-throw so TaskDetailModal can handle it
      }
    },
    [updateTask]
  );

  const handleModalForceComplete = useCallback(
    async (taskId: string) => {
      try {
        await completeTaskById({
          taskId: taskId as Id<'chatroom_tasks'>,
          force: true,
        });
      } catch (error) {
        console.error('Failed to force complete task:', error);
        throw error;
      }
    },
    [completeTaskById]
  );

  // Batch close all acknowledged tasks (force complete)
  const handleCloseAllAcknowledged = useCallback(async () => {
    if (!categorizedTasks.current) return;

    // Filter for acknowledged tasks
    const acknowledgedTasks = categorizedTasks.current.filter((t) => t.status === 'acknowledged');

    if (acknowledgedTasks.length === 0) {
      console.log('No acknowledged tasks to close');
      return;
    }

    // Force complete all acknowledged tasks
    try {
      await Promise.all(
        acknowledgedTasks.map((task) =>
          completeTaskById({
            taskId: task._id as Id<'chatroom_tasks'>,
            force: true,
          })
        )
      );
      console.log(`Closed ${acknowledgedTasks.length} acknowledged tasks`);
    } catch (error) {
      console.error('Failed to close all acknowledged tasks:', error);
    }
  }, [categorizedTasks.current, completeTaskById]);

  if (tasks === undefined) {
    return (
      <div className="flex flex-col border-b-2 border-chatroom-border-strong">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
          Task Queue
        </div>
        <div className="p-4 text-center text-chatroom-text-muted text-xs">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden flex-1 min-h-0">
      {/* Header */}
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border flex items-center justify-between flex-shrink-0">
        <span>Task Queue</span>
      </div>

      {/* Scrollable Task List Container */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Queue Health Warning - Show when promotion needed */}
        {needsPromotion && (
          <div className="p-3 border-b border-chatroom-border bg-chatroom-status-warning/10">
            <div className="flex items-center justify-between">
              <span className="text-xs text-chatroom-status-warning">
                Queue has tasks but none active
              </span>
              <button
                onClick={handlePromoteNext}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide bg-chatroom-status-warning text-chatroom-bg-primary hover:opacity-80 transition-colors"
                title="Promote next queued task to pending"
              >
                <Play size={10} />
                Start Next
              </button>
            </div>
          </div>
        )}

        {/* Current Task */}
        {categorizedTasks.current.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
              <span>Current ({categorizedTasks.current.length})</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1"
                    title="Actions"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem
                    onClick={handleCloseAllAcknowledged}
                    className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                  >
                    <XCircle size={14} />
                    Close All Acknowledged
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Show only first CURRENT_TASKS_PREVIEW_LIMIT items */}
            {categorizedTasks.current.slice(0, CURRENT_TASKS_PREVIEW_LIMIT).map((task) => (
              <TaskItem
                key={task._id}
                task={task}
                isProtected
                onClick={() => handleOpenTaskDetail(task)}
              />
            ))}
            {/* Show "View More" button when there are more items */}
            {categorizedTasks.current.length > CURRENT_TASKS_PREVIEW_LIMIT && (
              <ViewMoreButton
                count={categorizedTasks.current.length - CURRENT_TASKS_PREVIEW_LIMIT}
                onClick={() => setIsCurrentTasksModalOpen(true)}
              />
            )}
          </div>
        )}

        {/* Note: Queued messages are shown in MessageFeed (pinned above status bar), not here */}

        {/* Pending Review - Backlog items awaiting user confirmation */}
        {pendingReviewBacklogItems.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center gap-2">
              <ClipboardCheck size={12} className="text-violet-500 dark:text-violet-400" />
              <span>
                Pending Review ({pendingReviewBacklogItems.length})
              </span>
            </div>
            {/* Show backlog pending review items */}
            {pendingReviewBacklogItems
              .slice(0, PENDING_REVIEW_PREVIEW_LIMIT)
              .map((item) => (
                <PendingReviewBacklogItem
                  key={item._id}
                  item={item}
                  onClick={() => setSelectedBacklogItem(item)}
                />
              ))}
            {/* Show "View More" button when there are more items in total */}
            {pendingReviewBacklogItems.length > PENDING_REVIEW_PREVIEW_LIMIT && (
              <ViewMoreButton
                count={pendingReviewBacklogItems.length - PENDING_REVIEW_PREVIEW_LIMIT}
                onClick={() => setIsBacklogQueueModalOpen(true)}
              />
            )}
          </div>
        )}

        {/* Backlog Tasks */}
        <div className="border-b border-chatroom-border">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
            <span>Active Backlog ({categorizedTasks.backlog.length})</span>
            <button
              onClick={() => setIsBacklogCreateModalOpen(true)}
              className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
              title="Add to backlog"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Compact Backlog Items - Show first 3 */}
          {categorizedTasks.backlog.slice(0, 3).map((item) => (
            <CompactBacklogItem
              key={item._id}
              item={item}
              onClick={() => setSelectedBacklogItem(item)}
            />
          ))}

          {/* View More Button */}
          {categorizedTasks.backlog.length > 3 && (
            <ViewMoreButton
              count={categorizedTasks.backlog.length - 3}
              onClick={() => setIsBacklogQueueModalOpen(true)}
            />
          )}

          {categorizedTasks.backlog.length === 0 && (
            <div className="p-3 text-center text-chatroom-text-muted text-xs">
              No active backlog items
            </div>
          )}
        </div>
        {/* End of Backlog Tasks */}
      </div>
      {/* End of Scrollable Task List Container */}

      {/* Task Detail Modal - only mount when task is selected for better performance */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={true}
          task={selectedTask}
          onClose={handleCloseTaskDetail}
          onEdit={handleModalEdit}
          onDelete={handleModalForceComplete}
          onForceComplete={handleModalForceComplete}
        />
      )}

      {/* Full Task Queue Modal */}
      <TaskQueueModal
        isOpen={isQueueModalOpen}
        tasks={tasks || []}
        onClose={() => setIsQueueModalOpen(false)}
        onTaskClick={(task) => {
          // Keep queue modal open, detail modal will layer on top
          handleOpenTaskDetail(task);
        }}
      />

      {/* Pending Review Modal - Note: shows backlog items only since pending_user_review status removed */}
      {isPendingReviewModalOpen && (
        <PendingReviewModal
          tasks={[]}
          backlogItems={pendingReviewBacklogItems}
          onClose={() => setIsPendingReviewModalOpen(false)}
          onTaskClick={(task) => {
            handleOpenTaskDetail(task);
          }}
          onBacklogItemClick={(item) => {
            setSelectedBacklogItem(item);
          }}
        />
      )}

      {/* Current Tasks Modal */}
      {isCurrentTasksModalOpen && (
        <CurrentTasksModal
          tasks={categorizedTasks.current}
          onClose={() => setIsCurrentTasksModalOpen(false)}
          onTaskClick={(task) => {
            handleOpenTaskDetail(task);
          }}
        />
      )}

      {/* Backlog Create Modal */}
      <BacklogCreateModal
        isOpen={isBacklogCreateModalOpen}
        onClose={() => setIsBacklogCreateModalOpen(false)}
        onSubmit={handleAddTask}
      />

      {/* Backlog Item Detail Modal */}
      {selectedBacklogItem && (
        <BacklogItemDetailModal
          isOpen={true}
          item={selectedBacklogItem}
          onClose={() => setSelectedBacklogItem(null)}
        />
      )}

      {/* Backlog Queue Modal - shows all backlog items */}
      {isBacklogQueueModalOpen && (
        <BacklogQueueModal
          items={categorizedTasks.backlog}
          onClose={() => setIsBacklogQueueModalOpen(false)}
          onItemClick={(item) => {
            setSelectedBacklogItem(item);
          }}
        />
      )}
    </div>
  );
}

interface TaskItemProps {
  task: Task;
  isProtected?: boolean;
  onDelete?: () => void;
  onClick?: () => void;
}

function TaskItem({ task, isProtected = false, onDelete, onClick }: TaskItemProps) {
  const badge = getStatusBadge(task.status);

  const isClickable = !!onClick;

  return (
    <div
      className={`p-3 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {/* Status Badge */}
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
        >
          {badge.label}
        </span>
        {task.assignedTo && (
          <span className="text-[9px] text-chatroom-text-muted">→ {task.assignedTo}</span>
        )}
      </div>

      {/* Content - Rendered as Markdown */}
      <div className="text-xs text-chatroom-text-primary line-clamp-3 mb-2 prose dark:prose-invert prose-xs max-w-none prose-p:my-0 prose-headings:my-0 prose-headings:text-xs prose-headings:font-bold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-code:text-[10px] prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-pre:bg-chatroom-bg-tertiary prose-pre:text-chatroom-text-primary prose-pre:p-2 prose-pre:my-1 prose-pre:overflow-x-auto">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={baseMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Actions for editable tasks */}
      {!isProtected && (
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-status-error transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Compact Backlog Item - for sidebar display
interface CompactBacklogItemProps {
  item: BacklogItem;
  onClick: () => void;
}

// compactMarkdownComponents is imported from markdown-utils.tsx

function CompactBacklogItem({ item, onClick }: CompactBacklogItemProps) {
  const hasScoring = item.complexity || item.value || item.priority !== undefined;

  return (
    <div
      className="flex items-center gap-2 p-2 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Scoring badges */}
      {hasScoring && (
        <div className="flex-shrink-0 flex items-center gap-1">
          {item.priority !== undefined && (
            <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
              P:{item.priority}
            </span>
          )}
          {item.complexity && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
            >
              {getScoringBadge('complexity', item.complexity).label}
            </span>
          )}
          {item.value && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
            >
              {getScoringBadge('value', item.value).label}
            </span>
          )}
        </div>
      )}

      {/* Content - 2 lines max, with simplified markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {item.content}
        </Markdown>
      </div>

      {/* Arrow to indicate clickable */}
      <ChevronRight
        size={14}
        className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
      />
    </div>
  );
}

// ViewMoreButton - shared component for expandable list sections
interface ViewMoreButtonProps {
  count: number;
  onClick: () => void;
}

function ViewMoreButton({ count, onClick }: ViewMoreButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full p-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors text-center"
    >
      View More ({count} more items)
    </button>
  );
}

// Pending Review Item - for tasks awaiting user confirmation
// Helper to format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Pending Review Modal Component
interface PendingReviewModalProps {
  tasks: Task[];
  backlogItems: BacklogItem[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
  onBacklogItemClick: (item: BacklogItem) => void;
}

function PendingReviewModal({
  tasks,
  backlogItems,
  onClose,
  onTaskClick,
  onBacklogItemClick,
}: PendingReviewModalProps) {
  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-xl md:max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-violet-500 dark:text-violet-400" />
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Pending Review ({tasks.length + backlogItems.length})
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tasks.length === 0 && backlogItems.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              No tasks pending review
            </div>
          ) : (
            <>
              {tasks.map((task) => (
                <PendingReviewModalItem
                  key={task._id}
                  task={task}
                  onClick={() => onTaskClick(task)}
                />
              ))}
              {backlogItems.map((item) => (
                <PendingReviewBacklogModalItem
                  key={item._id}
                  item={item}
                  onClick={() => onBacklogItemClick(item)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Pending Review Modal Item - Similar to PendingReviewItem but for modal display
interface PendingReviewModalItemProps {
  task: Task;
  onClick: () => void;
}

function PendingReviewModalItem({ task, onClick }: PendingReviewModalItemProps) {
  const relativeTime = task.updatedAt ? formatRelativeTime(task.updatedAt) : '';

  return (
    <div
      className="flex items-start gap-3 p-3 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group border-b border-chatroom-border last:border-b-0"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Review Badge */}
      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400">
        Review
      </span>

      {/* Content - with markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>
    </div>
  );
}

// Pending Review Backlog Item (sidebar) - for backlog items awaiting user confirmation
interface PendingReviewBacklogItemProps {
  item: BacklogItem;
  onClick: () => void;
}

function PendingReviewBacklogItem({ item, onClick }: PendingReviewBacklogItemProps) {
  const relativeTime = formatRelativeTime(item.updatedAt);

  return (
    <div
      className="flex items-center gap-2 p-2 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Review Badge - Purple/Violet for visual distinction */}
      <span className="flex-shrink-0 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400">
        Review
      </span>

      {/* Scoring badges */}
      {(item.complexity || item.value || item.priority !== undefined) && (
        <div className="flex-shrink-0 flex items-center gap-1">
          {item.priority !== undefined && (
            <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
              P:{item.priority}
            </span>
          )}
          {item.complexity && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
            >
              {getScoringBadge('complexity', item.complexity).label}
            </span>
          )}
          {item.value && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
            >
              {getScoringBadge('value', item.value).label}
            </span>
          )}
        </div>
      )}

      {/* Content - 2 lines max */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {item.content}
        </Markdown>
      </div>

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>

      {/* Arrow to indicate clickable */}
      <ChevronRight
        size={14}
        className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
      />
    </div>
  );
}

// Pending Review Backlog Modal Item - for backlog items in the PendingReviewModal
interface PendingReviewBacklogModalItemProps {
  item: BacklogItem;
  onClick: () => void;
}

function PendingReviewBacklogModalItem({ item, onClick }: PendingReviewBacklogModalItemProps) {
  const relativeTime = item.updatedAt ? formatRelativeTime(item.updatedAt) : '';

  return (
    <div
      className="flex items-start gap-3 p-3 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group border-b border-chatroom-border last:border-b-0"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Review Badge */}
      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400">
        Review
      </span>

      {/* Scoring badges */}
      {(item.complexity || item.value || item.priority !== undefined) && (
        <div className="flex-shrink-0 flex items-center gap-1">
          {item.priority !== undefined && (
            <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
              P:{item.priority}
            </span>
          )}
          {item.complexity && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
            >
              {getScoringBadge('complexity', item.complexity).label}
            </span>
          )}
          {item.value && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
            >
              {getScoringBadge('value', item.value).label}
            </span>
          )}
        </div>
      )}

      {/* Content - with markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {item.content}
        </Markdown>
      </div>

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>
    </div>
  );
}

// Current Tasks Modal Component
interface CurrentTasksModalProps {
  tasks: Task[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
}

function CurrentTasksModal({ tasks, onClose, onTaskClick }: CurrentTasksModalProps) {
  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-xl md:max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Current Tasks ({tasks.length})
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">No current tasks</div>
          ) : (
            tasks.map((task) => (
              <CurrentTasksModalItem key={task._id} task={task} onClick={() => onTaskClick(task)} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

// Current Tasks Modal Item - Similar to TaskItem but for modal display
interface CurrentTasksModalItemProps {
  task: Task;
  onClick: () => void;
}

function CurrentTasksModalItem({ task, onClick }: CurrentTasksModalItemProps) {
  const badge = getStatusBadge(task.status);
  const relativeTime = task.updatedAt ? formatRelativeTime(task.updatedAt) : '';

  return (
    <div
      className="flex items-start gap-3 p-3 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group border-b border-chatroom-border last:border-b-0"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Status Badge */}
      <span
        className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
      >
        {badge.label}
      </span>

      {/* Content - with markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Assigned To */}
      {task.assignedTo && (
        <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">
          → {task.assignedTo}
        </span>
      )}

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>
    </div>
  );
}

// Backlog Queue Modal Component - shows all backlog items
interface BacklogQueueModalProps {
  items: BacklogItem[];
  onClose: () => void;
  onItemClick: (item: BacklogItem) => void;
}

function BacklogQueueModal({ items, onClose, onItemClick }: BacklogQueueModalProps) {
  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-xl md:max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            Active Backlog ({items.length} items)
          </span>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Backlog Item List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {items.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              No active backlog items
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item._id}
                className="flex items-start gap-3 p-3 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group border-b border-chatroom-border last:border-b-0"
                onClick={() => onItemClick(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onItemClick(item);
                  }
                }}
              >
                {/* Status Badge - reflects actual item status */}
                {(() => {
                  const itemBadge = getBacklogStatusBadge(item.status);
                  return (
                    <span
                      className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${itemBadge.classes}`}
                    >
                      {itemBadge.label}
                    </span>
                  );
                })()}

                {/* Scoring badges */}
                {(item.complexity || item.value || item.priority !== undefined) && (
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {item.priority !== undefined && (
                      <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
                        P:{item.priority}
                      </span>
                    )}
                    {item.complexity && (
                      <span
                        className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
                      >
                        {getScoringBadge('complexity', item.complexity).label}
                      </span>
                    )}
                    {item.value && (
                      <span
                        className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
                      >
                        {getScoringBadge('value', item.value).label}
                      </span>
                    )}
                  </div>
                )}

                {/* Content - with markdown */}
                <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
                  <Markdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={compactMarkdownComponents}
                  >
                    {item.content}
                  </Markdown>
                </div>

                {/* Arrow */}
                <ChevronRight
                  size={14}
                  className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Play,
  ChevronRight,
  ChevronDown,
  Archive,
  ClipboardCheck,
  MoreHorizontal,
  XCircle,
} from 'lucide-react';
import React, { useState, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { BacklogCreateModal } from './BacklogCreateModal';
import { compactMarkdownComponents } from './markdown-utils';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQueueModal } from './TaskQueueModal';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type TaskStatus =
  | 'pending'
  | 'acknowledged'
  | 'in_progress'
  | 'queued'
  | 'backlog'
  | 'backlog_acknowledged'
  | 'pending_user_review'
  | 'completed'
  | 'closed'
  | 'cancelled'; // deprecated

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
  backlog_acknowledged: number;
  pending_user_review: number;
  completed: number;
  closed: number;
  cancelled: number; // deprecated
}

interface QueueHealth {
  hasActiveTask: boolean;
  queuedCount: number;
  needsPromotion: boolean;
}

interface TaskQueueProps {
  chatroomId: string;
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
    case 'backlog_acknowledged':
      return {
        emoji: '🟢',
        label: 'Backlog Acknowledged',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'in_progress':
      return {
        emoji: '🔵',
        label: 'In Progress',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'queued':
      return {
        emoji: '🟡',
        label: 'Queued',
        classes: 'bg-chatroom-status-warning/15 text-chatroom-status-warning',
      };
    case 'backlog':
      return {
        emoji: '⚪',
        label: 'Backlog',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'pending_user_review':
      return {
        emoji: '🟣',
        label: 'Pending User Review',
        classes: 'bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400',
      };
    case 'completed':
      return {
        emoji: '✅',
        label: 'Completed',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'closed':
      return {
        emoji: '⚫',
        label: 'Closed',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'cancelled':
      return {
        emoji: '⚫',
        label: 'Cancelled',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
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

export function TaskQueue({ chatroomId }: TaskQueueProps) {
  const [isBacklogCreateModalOpen, setIsBacklogCreateModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [isPendingReviewModalOpen, setIsPendingReviewModalOpen] = useState(false);
  const [isCurrentTasksModalOpen, setIsCurrentTasksModalOpen] = useState(false);

  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasksApi = api as any;

  // Query tasks
  const tasks = useSessionQuery(tasksApi.tasks.listTasks, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'active',
    limit: 100, // Match MAX_TASK_LIST_LIMIT from backend
  }) as Task[] | undefined;

  // Query task counts
  const counts = useSessionQuery(tasksApi.tasks.getTaskCounts, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TaskCounts | undefined;

  // Query queue health
  const queueHealth = useSessionQuery(tasksApi.tasks.checkQueueHealth, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as QueueHealth | undefined;

  // Query pending review tasks (tasks with pending_user_review status)
  const pendingReviewTasks = useSessionQuery(tasksApi.tasks.listTasks, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'pending_review',
    limit: 100, // Match MAX_TASK_LIST_LIMIT from backend
  }) as Task[] | undefined;

  // No frontend filtering needed - backend handles pending_review filter
  const filteredPendingReviewTasks = pendingReviewTasks ?? [];

  // Query archived tasks (only when expanded)
  const archivedTasks = useSessionQuery(
    tasksApi.tasks.listTasks,
    isArchivedExpanded
      ? {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          statusFilter: 'archived' as const,
          limit: 100, // Match MAX_TASK_LIST_LIMIT from backend
        }
      : 'skip'
  ) as Task[] | undefined;

  // Mutations
  const createTask = useSessionMutation(tasksApi.tasks.createTask);
  const promoteNextTask = useSessionMutation(tasksApi.tasks.promoteNextTask);
  const updateTask = useSessionMutation(tasksApi.tasks.updateTask);
  const cancelTask = useSessionMutation(tasksApi.tasks.cancelTask);
  const completeTaskById = useSessionMutation(tasksApi.tasks.completeTaskById);
  const markBacklogComplete = useSessionMutation(tasksApi.tasks.markBacklogComplete);
  const closeBacklogTask = useSessionMutation(tasksApi.tasks.closeBacklogTask);
  const reopenBacklogTask = useSessionMutation(tasksApi.tasks.reopenBacklogTask);

  // Categorize tasks by status
  // Backlog items sorted by priority descending (higher first), then by createdAt descending
  // Tasks without priority sort to the end
  const categorizedTasks = useMemo(() => {
    if (!tasks) return { current: [], queued: [], backlog: [] };

    // Filter backlog tasks and sort by priority descending, then createdAt descending
    const backlogTasks = tasks
      .filter((t) => t.status === 'backlog')
      .sort((a, b) => {
        const aPriority = a.priority ?? -Infinity;
        const bPriority = b.priority ?? -Infinity;
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        return b.createdAt - a.createdAt; // Newer first as tiebreaker
      });

    return {
      current: tasks.filter(
        (t) =>
          t.status === 'pending' ||
          t.status === 'acknowledged' ||
          t.status === 'in_progress' ||
          t.status === 'backlog_acknowledged'
      ),
      queued: tasks.filter((t) => t.status === 'queued'),
      backlog: backlogTasks,
    };
  }, [tasks]);

  // Count archived items using task counts from backend
  // This ensures the count is accurate even when archived section is collapsed
  const archivedCount = useMemo(() => {
    if (!counts) return 0;
    return counts.completed + counts.closed;
  }, [counts]);

  // Handlers
  const handleAddTask = useCallback(
    async (content: string) => {
      await createTask({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        content,
        createdBy: 'user',
        isBacklog: true,
      });
    },
    [createTask, chatroomId]
  );

  const handleEditTask = useCallback(
    async (taskId: string) => {
      if (!editedContent.trim()) return;

      try {
        await updateTask({
          taskId: taskId as Id<'chatroom_tasks'>,
          content: editedContent.trim(),
        });
        setEditingTaskId(null);
        setEditedContent('');
      } catch (error) {
        console.error('Failed to update task:', error);
      }
    },
    [updateTask, editedContent]
  );

  const handleCancelTask = useCallback(
    async (taskId: string) => {
      try {
        await cancelTask({
          taskId: taskId as Id<'chatroom_tasks'>,
        });
      } catch (error) {
        console.error('Failed to cancel task:', error);
      }
    },
    [cancelTask]
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

  const startEditing = useCallback((task: Task) => {
    setEditingTaskId(task._id);
    setEditedContent(task.content);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingTaskId(null);
    setEditedContent('');
  }, []);

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

  const handleModalDelete = useCallback(
    async (taskId: string) => {
      try {
        await cancelTask({
          taskId: taskId as Id<'chatroom_tasks'>,
        });
      } catch (error) {
        console.error('Failed to delete task:', error);
        throw error;
      }
    },
    [cancelTask]
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

  const handleModalMarkBacklogComplete = useCallback(
    async (taskId: string) => {
      try {
        await markBacklogComplete({
          taskId: taskId as Id<'chatroom_tasks'>,
        });
      } catch (error) {
        console.error('Failed to mark backlog complete:', error);
        throw error;
      }
    },
    [markBacklogComplete]
  );

  const handleModalCloseBacklog = useCallback(
    async (taskId: string) => {
      try {
        await closeBacklogTask({
          taskId: taskId as Id<'chatroom_tasks'>,
        });
      } catch (error) {
        console.error('Failed to close backlog task:', error);
        throw error;
      }
    },
    [closeBacklogTask]
  );

  const handleModalReopenBacklog = useCallback(
    async (taskId: string) => {
      try {
        await reopenBacklogTask({
          taskId: taskId as Id<'chatroom_tasks'>,
        });
      } catch (error) {
        console.error('Failed to reopen backlog task:', error);
        throw error;
      }
    },
    [reopenBacklogTask]
  );

  // Batch close all claimed tasks
  const handleCloseAllClaimed = useCallback(async () => {
    if (!categorizedTasks.current) return;

    // Filter for acknowledged and backlog_acknowledged tasks
    const claimedTasks = categorizedTasks.current.filter(
      (t) => t.status === 'acknowledged' || t.status === 'backlog_acknowledged'
    );

    if (claimedTasks.length === 0) {
      console.log('No claimed tasks to close');
      return;
    }

    // Close all claimed tasks
    try {
      await Promise.all(
        claimedTasks.map((task) =>
          cancelTask({
            taskId: task._id as Id<'chatroom_tasks'>,
          })
        )
      );
      console.log(`Closed ${claimedTasks.length} claimed tasks`);
    } catch (error) {
      console.error('Failed to close all claimed tasks:', error);
    }
  }, [categorizedTasks.current, cancelTask]);

  // Calculate active total
  const activeTotal = useMemo(() => {
    if (!counts) return 0;
    return (
      counts.pending +
      counts.acknowledged +
      counts.in_progress +
      counts.queued +
      counts.backlog +
      counts.backlog_acknowledged
    );
  }, [counts]);

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
        <span className="text-chatroom-text-muted font-normal">{activeTotal}/100</span>
      </div>

      {/* Scrollable Task List Container */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Queue Health Warning - Show when promotion needed */}
        {queueHealth?.needsPromotion && (
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
                    onClick={handleCloseAllClaimed}
                    className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                  >
                    <XCircle size={14} />
                    Close All Claimed
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

        {/* Queued Tasks */}
        {categorizedTasks.queued.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary">
              Queued ({categorizedTasks.queued.length})
            </div>
            {categorizedTasks.queued.map((task) => (
              <TaskItem
                key={task._id}
                task={task}
                isEditing={editingTaskId === task._id}
                editedContent={editedContent}
                onStartEdit={() => startEditing(task)}
                onSaveEdit={() => handleEditTask(task._id)}
                onCancelEdit={cancelEditing}
                onEditContentChange={setEditedContent}
                onDelete={() => handleCancelTask(task._id)}
              />
            ))}
          </div>
        )}

        {/* Pending Review - Tasks completed by agents awaiting user confirmation */}
        {filteredPendingReviewTasks.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center gap-2">
              <ClipboardCheck size={12} className="text-violet-500 dark:text-violet-400" />
              <span>Pending Review ({filteredPendingReviewTasks.length})</span>
            </div>
            {/* Show only first PENDING_REVIEW_PREVIEW_LIMIT items */}
            {filteredPendingReviewTasks.slice(0, PENDING_REVIEW_PREVIEW_LIMIT).map((task) => (
              <PendingReviewItem
                key={task._id}
                task={task}
                onClick={() => handleOpenTaskDetail(task)}
              />
            ))}
            {/* Show "View More" button when there are more items */}
            {filteredPendingReviewTasks.length > PENDING_REVIEW_PREVIEW_LIMIT && (
              <ViewMoreButton
                count={filteredPendingReviewTasks.length - PENDING_REVIEW_PREVIEW_LIMIT}
                onClick={() => setIsPendingReviewModalOpen(true)}
              />
            )}
          </div>
        )}

        {/* Backlog Tasks */}
        <div className="border-b border-chatroom-border">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
            <span>Backlog ({categorizedTasks.backlog.length})</span>
            <button
              onClick={() => setIsBacklogCreateModalOpen(true)}
              className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
              title="Add to backlog"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Compact Backlog Items - Show first 3 */}
          {categorizedTasks.backlog.slice(0, 3).map((task) => (
            <CompactBacklogItem
              key={task._id}
              task={task}
              onClick={() => handleOpenTaskDetail(task)}
            />
          ))}

          {/* View More Button */}
          {categorizedTasks.backlog.length > 3 && (
            <ViewMoreButton
              count={categorizedTasks.backlog.length - 3}
              onClick={() => setIsQueueModalOpen(true)}
            />
          )}

          {categorizedTasks.backlog.length === 0 && (
            <div className="p-3 text-center text-chatroom-text-muted text-xs">No backlog items</div>
          )}
        </div>
        {/* End of Backlog Tasks */}

        {/* Archived Section - Expandable */}
        {archivedCount > 0 && (
          <div className="border-b border-chatroom-border">
            <button
              onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
              className="w-full px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between hover:bg-chatroom-bg-hover transition-colors"
            >
              <span className="flex items-center gap-2">
                <Archive size={12} />
                Archived ({archivedCount})
              </span>
              {isArchivedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {isArchivedExpanded && (
              <div>
                {archivedTasks === undefined ? (
                  <div className="p-3 text-center text-chatroom-text-muted text-xs">Loading...</div>
                ) : archivedTasks.length === 0 ? (
                  <div className="p-3 text-center text-chatroom-text-muted text-xs">
                    No archived items
                  </div>
                ) : (
                  archivedTasks.map((task) => (
                    <ArchivedBacklogItem
                      key={task._id}
                      task={task}
                      onClick={() => handleOpenTaskDetail(task)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {/* End of Scrollable Task List Container */}

      {/* Task Detail Modal - only mount when task is selected for better performance */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={true}
          task={selectedTask}
          onClose={handleCloseTaskDetail}
          onEdit={handleModalEdit}
          onDelete={handleModalDelete}
          onForceComplete={handleModalForceComplete}
          onMarkBacklogComplete={handleModalMarkBacklogComplete}
          onCloseBacklog={handleModalCloseBacklog}
          onReopenBacklog={handleModalReopenBacklog}
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

      {/* Pending Review Modal */}
      {isPendingReviewModalOpen && (
        <PendingReviewModal
          tasks={filteredPendingReviewTasks}
          onClose={() => setIsPendingReviewModalOpen(false)}
          onTaskClick={(task) => {
            handleOpenTaskDetail(task);
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
    </div>
  );
}

interface TaskItemProps {
  task: Task;
  isProtected?: boolean;
  isEditing?: boolean;
  editedContent?: string;
  onStartEdit?: () => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onEditContentChange?: (content: string) => void;
  onDelete?: () => void;
  onClick?: () => void;
}

function TaskItem({
  task,
  isProtected = false,
  isEditing = false,
  editedContent = '',
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditContentChange,
  onDelete,
  onClick,
}: TaskItemProps) {
  const badge = getStatusBadge(task.status);

  if (isEditing) {
    return (
      <div className="p-3 border-b border-chatroom-border bg-chatroom-bg-hover">
        <textarea
          value={editedContent}
          onChange={(e) => onEditContentChange?.(e.target.value)}
          onKeyDown={(e) => {
            // Cmd+Enter or Ctrl+Enter to save
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (editedContent.trim() && onSaveEdit) {
                onSaveEdit();
              }
            }
          }}
          className="w-full bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary text-xs p-2 resize-none focus:outline-none focus:border-chatroom-accent"
          rows={2}
          autoFocus
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={onSaveEdit}
            disabled={!editedContent.trim()}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={12} />
            Save
          </button>
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      </div>
    );
  }

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
        <Markdown remarkPlugins={[remarkGfm]}>{task.content}</Markdown>
      </div>

      {/* Actions for editable tasks */}
      {!isProtected && (
        <div className="flex items-center gap-1">
          {onStartEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
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
  task: Task;
  onClick: () => void;
}

// compactMarkdownComponents is imported from markdown-utils.tsx

// Scoring badge helper for complexity/value
function getScoringBadge(type: 'complexity' | 'value', level: 'low' | 'medium' | 'high') {
  const colors = {
    low: 'bg-green-500/15 text-green-600 dark:text-green-400',
    medium: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
    high: 'bg-red-500/15 text-red-600 dark:text-red-400',
  };
  const labels = {
    complexity: { low: 'C:L', medium: 'C:M', high: 'C:H' },
    value: { low: 'V:L', medium: 'V:M', high: 'V:H' },
  };
  return {
    label: labels[type][level],
    classes: colors[level],
  };
}

function CompactBacklogItem({ task, onClick }: CompactBacklogItemProps) {
  const hasScoring = task.complexity || task.value || task.priority !== undefined;

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
          {task.priority !== undefined && (
            <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
              P:{task.priority}
            </span>
          )}
          {task.complexity && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', task.complexity).classes}`}
            >
              {getScoringBadge('complexity', task.complexity).label}
            </span>
          )}
          {task.value && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', task.value).classes}`}
            >
              {getScoringBadge('value', task.value).label}
            </span>
          )}
        </div>
      )}

      {/* Content - 2 lines max, with simplified markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
          {task.content}
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

// Archived Backlog Item - for archived section display
interface ArchivedBacklogItemProps {
  task: Task;
  onClick: () => void;
}

function ArchivedBacklogItem({ task, onClick }: ArchivedBacklogItemProps) {
  const backlogStatus = task.backlog?.status;
  const statusLabel = backlogStatus === 'complete' ? 'Complete' : 'Closed';
  const statusClasses =
    backlogStatus === 'complete'
      ? 'bg-chatroom-status-success/15 text-chatroom-status-success'
      : 'bg-chatroom-text-muted/15 text-chatroom-text-muted';

  // Format date
  const formattedDate = new Date(task.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div
      className="flex items-center gap-2 p-2 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors cursor-pointer"
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
        className={`flex-shrink-0 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide ${statusClasses}`}
      >
        {statusLabel}
      </span>

      {/* Content - 1 line max */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-muted line-clamp-1">
        <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Date */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{formattedDate}</span>
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
interface PendingReviewItemProps {
  task: Task;
  onClick: () => void;
}

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

function PendingReviewItem({ task, onClick }: PendingReviewItemProps) {
  const relativeTime = formatRelativeTime(task.updatedAt);

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

      {/* Content - 2 lines max */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
          {task.content}
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

// Pending Review Modal Component
interface PendingReviewModalProps {
  tasks: Task[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
}

function PendingReviewModal({ tasks, onClose, onTaskClick }: PendingReviewModalProps) {
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
              Pending Review ({tasks.length})
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
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              No tasks pending review
            </div>
          ) : (
            tasks.map((task) => (
              <PendingReviewModalItem
                key={task._id}
                task={task}
                onClick={() => onTaskClick(task)}
              />
            ))
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
        <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
          {task.content}
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
        <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
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

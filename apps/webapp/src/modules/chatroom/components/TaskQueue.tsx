'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Plus, Pencil, Trash2, ArrowRight, X, Check, Play, ChevronRight } from 'lucide-react';
import React, { useState, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { TaskDetailModal } from './TaskDetailModal';
import { TaskQueueModal } from './TaskQueueModal';

type TaskStatus = 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  createdAt: number;
  queuePosition: number;
  assignedTo?: string;
}

interface TaskCounts {
  pending: number;
  in_progress: number;
  queued: number;
  backlog: number;
  completed: number;
  cancelled: number;
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
    case 'in_progress':
      return {
        emoji: '🔵',
        label: 'Working',
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
    default:
      return {
        emoji: '⚫',
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

export function TaskQueue({ chatroomId }: TaskQueueProps) {
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskContent, setNewTaskContent] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);

  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasksApi = api as any;

  // Query tasks
  const tasks = useSessionQuery(tasksApi.tasks.listTasks, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'active',
    limit: 50,
  }) as Task[] | undefined;

  // Query task counts
  const counts = useSessionQuery(tasksApi.tasks.getTaskCounts, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TaskCounts | undefined;

  // Query queue health
  const queueHealth = useSessionQuery(tasksApi.tasks.checkQueueHealth, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as QueueHealth | undefined;

  // Mutations
  const createTask = useSessionMutation(tasksApi.tasks.createTask);
  const promoteNextTask = useSessionMutation(tasksApi.tasks.promoteNextTask);
  const updateTask = useSessionMutation(tasksApi.tasks.updateTask);
  const cancelTask = useSessionMutation(tasksApi.tasks.cancelTask);
  const moveToQueue = useSessionMutation(tasksApi.tasks.moveToQueue);

  // Categorize tasks
  const categorizedTasks = useMemo(() => {
    if (!tasks) return { current: [], queued: [], backlog: [] };

    return {
      current: tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress'),
      queued: tasks.filter((t) => t.status === 'queued'),
      backlog: tasks.filter((t) => t.status === 'backlog'),
    };
  }, [tasks]);

  // Handlers
  const handleAddTask = useCallback(async () => {
    if (!newTaskContent.trim()) return;

    try {
      await createTask({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        content: newTaskContent.trim(),
        createdBy: 'user',
        isBacklog: true,
      });
      setNewTaskContent('');
      setIsAddingTask(false);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  }, [createTask, chatroomId, newTaskContent]);

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

  const handleMoveToQueue = useCallback(
    async (taskId: string) => {
      try {
        await moveToQueue({
          taskId: taskId as Id<'chatroom_tasks'>,
        });
      } catch (error) {
        console.error('Failed to move task:', error);
      }
    },
    [moveToQueue]
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
      await updateTask({
        taskId: taskId as Id<'chatroom_tasks'>,
        content,
      });
    },
    [updateTask]
  );

  const handleModalDelete = useCallback(
    async (taskId: string) => {
      await cancelTask({
        taskId: taskId as Id<'chatroom_tasks'>,
      });
    },
    [cancelTask]
  );

  const handleModalMoveToQueue = useCallback(
    async (taskId: string) => {
      await moveToQueue({
        taskId: taskId as Id<'chatroom_tasks'>,
      });
    },
    [moveToQueue]
  );

  // Calculate active total
  const activeTotal = useMemo(() => {
    if (!counts) return 0;
    return counts.pending + counts.in_progress + counts.queued + counts.backlog;
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
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary">
              Current
            </div>
            {categorizedTasks.current.map((task) => (
              <TaskItem key={task._id} task={task} isProtected />
            ))}
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

        {/* Backlog Tasks */}
        <div className="border-b border-chatroom-border">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
            <span>Backlog ({categorizedTasks.backlog.length})</span>
            {!isAddingTask && (
              <button
                onClick={() => setIsAddingTask(true)}
                className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
                title="Add to backlog"
              >
                <Plus size={14} />
              </button>
            )}
          </div>

          {/* Add Task Form */}
          {isAddingTask && (
            <div className="p-3 border-b border-chatroom-border bg-chatroom-bg-hover">
              <textarea
                value={newTaskContent}
                onChange={(e) => setNewTaskContent(e.target.value)}
                onKeyDown={(e) => {
                  // Cmd+Enter or Ctrl+Enter to add
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (newTaskContent.trim()) {
                      handleAddTask();
                    }
                  }
                }}
                placeholder="Enter task description..."
                className="w-full bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary text-xs p-2 resize-none focus:outline-none focus:border-chatroom-accent"
                rows={2}
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleAddTask}
                  disabled={!newTaskContent.trim()}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check size={12} />
                  Add
                </button>
                <button
                  onClick={() => {
                    setIsAddingTask(false);
                    setNewTaskContent('');
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary"
                >
                  <X size={12} />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Compact Backlog Items - Show first 3 */}
          {categorizedTasks.backlog.slice(0, 3).map((task) => (
            <CompactBacklogItem
              key={task._id}
              task={task}
              onClick={() => handleOpenTaskDetail(task)}
              onMoveToQueue={() => handleMoveToQueue(task._id)}
            />
          ))}

          {/* View More Button */}
          {categorizedTasks.backlog.length > 3 && (
            <button
              onClick={() => setIsQueueModalOpen(true)}
              className="w-full p-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors text-center"
            >
              View More ({categorizedTasks.backlog.length - 3} more items)
            </button>
          )}

          {categorizedTasks.backlog.length === 0 && !isAddingTask && (
            <div className="p-3 text-center text-chatroom-text-muted text-xs">No backlog items</div>
          )}
        </div>
        {/* End of Backlog Tasks */}
      </div>
      {/* End of Scrollable Task List Container */}

      {/* Task Detail Modal */}
      <TaskDetailModal
        isOpen={selectedTask !== null}
        task={selectedTask}
        onClose={handleCloseTaskDetail}
        onEdit={handleModalEdit}
        onDelete={handleModalDelete}
        onMoveToQueue={handleModalMoveToQueue}
      />

      {/* Full Task Queue Modal */}
      <TaskQueueModal
        isOpen={isQueueModalOpen}
        tasks={tasks || []}
        onClose={() => setIsQueueModalOpen(false)}
        onTaskClick={(task) => {
          setIsQueueModalOpen(false);
          handleOpenTaskDetail(task);
        }}
        onMoveToQueue={handleModalMoveToQueue}
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
  onMoveToQueue?: () => void;
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
  onMoveToQueue,
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

  return (
    <div className="p-3 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors">
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
      <div className="text-xs text-chatroom-text-primary line-clamp-3 mb-2 prose dark:prose-invert prose-xs max-w-none prose-p:my-0 prose-headings:my-0 prose-headings:text-xs prose-headings:font-bold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-code:text-[10px] prose-code:bg-chatroom-bg-tertiary prose-code:px-1">
        <Markdown remarkPlugins={[remarkGfm]}>{task.content}</Markdown>
      </div>

      {/* Actions */}
      {!isProtected && (
        <div className="flex items-center gap-1">
          {onStartEdit && (
            <button
              onClick={onStartEdit}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-status-error transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
          {onMoveToQueue && (
            <button
              onClick={onMoveToQueue}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-accent transition-colors"
              title="Move to queue"
            >
              <ArrowRight size={12} />
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
  onMoveToQueue: () => void;
}

function CompactBacklogItem({ task, onClick, onMoveToQueue }: CompactBacklogItemProps) {
  const handleMoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onMoveToQueue();
    },
    [onMoveToQueue]
  );

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
      {/* Content - 2 lines max */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        {task.content}
      </div>

      {/* Move to Queue Arrow */}
      <button
        onClick={handleMoveClick}
        className="flex-shrink-0 p-1 text-chatroom-text-muted hover:text-chatroom-accent opacity-0 group-hover:opacity-100 transition-all"
        title="Move to queue"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

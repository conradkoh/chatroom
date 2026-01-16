'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ArrowRight, Search, X } from 'lucide-react';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type TaskStatus = 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  createdAt: number;
  queuePosition: number;
  assignedTo?: string;
}

interface TaskQueueModalProps {
  isOpen: boolean;
  tasks: Task[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
  onMoveToQueue: (taskId: string) => Promise<void>;
}

// Status badge colors
const getStatusBadge = (status: TaskStatus) => {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'in_progress':
      return {
        label: 'Working',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'queued':
      return {
        label: 'Queued',
        classes: 'bg-chatroom-status-warning/15 text-chatroom-status-warning',
      };
    case 'backlog':
      return {
        label: 'Backlog',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    default:
      return {
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

export function TaskQueueModal({
  isOpen,
  tasks,
  onClose,
  onTaskClick,
  onMoveToQueue,
}: TaskQueueModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Filter tasks by search query
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) {
      return tasks;
    }
    const query = searchQuery.toLowerCase();
    return tasks.filter((task) => task.content.toLowerCase().includes(query));
  }, [tasks, searchQuery]);

  // Group tasks by status
  const groupedTasks = useMemo(() => {
    const groups: Record<string, Task[]> = {
      current: [],
      queued: [],
      backlog: [],
    };

    for (const task of filteredTasks) {
      if (task.status === 'pending' || task.status === 'in_progress') {
        groups.current.push(task);
      } else if (task.status === 'queued') {
        groups.queued.push(task);
      } else if (task.status === 'backlog') {
        groups.backlog.push(task);
      }
    }

    return groups;
  }, [filteredTasks]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-2xl md:max-h-[85vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              All Tasks
            </span>
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Task Queue ({tasks.length})
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

        {/* Search */}
        <div className="p-3 border-b border-chatroom-border flex-shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted"
            />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-chatroom-bg-tertiary border-2 border-chatroom-border text-chatroom-text-primary text-sm pl-9 pr-3 py-2 focus:outline-none focus:border-chatroom-accent placeholder:text-chatroom-text-muted"
            />
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filteredTasks.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              {searchQuery ? 'No tasks match your search' : 'No tasks found'}
            </div>
          ) : (
            <>
              {/* Current Tasks */}
              {groupedTasks.current.length > 0 && (
                <TaskGroup
                  title="Current"
                  tasks={groupedTasks.current}
                  onTaskClick={onTaskClick}
                  onMoveToQueue={onMoveToQueue}
                  isProtected
                />
              )}

              {/* Queued Tasks */}
              {groupedTasks.queued.length > 0 && (
                <TaskGroup
                  title={`Queued (${groupedTasks.queued.length})`}
                  tasks={groupedTasks.queued}
                  onTaskClick={onTaskClick}
                  onMoveToQueue={onMoveToQueue}
                />
              )}

              {/* Backlog Tasks */}
              {groupedTasks.backlog.length > 0 && (
                <TaskGroup
                  title={`Backlog (${groupedTasks.backlog.length})`}
                  tasks={groupedTasks.backlog}
                  onTaskClick={onTaskClick}
                  onMoveToQueue={onMoveToQueue}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Task Group Component
interface TaskGroupProps {
  title: string;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onMoveToQueue: (taskId: string) => Promise<void>;
  isProtected?: boolean;
}

function TaskGroup({
  title,
  tasks,
  onTaskClick,
  onMoveToQueue,
  isProtected = false,
}: TaskGroupProps) {
  return (
    <div className="border-b border-chatroom-border last:border-b-0">
      <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary sticky top-0">
        {title}
      </div>
      {tasks.map((task) => (
        <TaskListItem
          key={task._id}
          task={task}
          onClick={() => onTaskClick(task)}
          onMoveToQueue={() => onMoveToQueue(task._id)}
          isProtected={isProtected}
        />
      ))}
    </div>
  );
}

// Simplified markdown components for compact display
const compactMarkdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h6: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ul: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ol: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  li: ({ children }: { children?: React.ReactNode }) => <span>• {children} </span>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="bg-chatroom-bg-tertiary px-0.5 text-[10px]">{children}</code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  a: ({ children }: { children?: React.ReactNode }) => (
    <span className="underline">{children}</span>
  ),
};

// Task List Item Component
interface TaskListItemProps {
  task: Task;
  onClick: () => void;
  onMoveToQueue: () => void;
  isProtected?: boolean;
}

function TaskListItem({ task, onClick, onMoveToQueue, isProtected = false }: TaskListItemProps) {
  const badge = getStatusBadge(task.status);

  const handleMoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onMoveToQueue();
    },
    [onMoveToQueue]
  );

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

      {/* Content - with simplified markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm]} components={compactMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Move to Queue Button (only for backlog) */}
      {!isProtected && task.status === 'backlog' && (
        <button
          onClick={handleMoveClick}
          className="flex-shrink-0 p-1 text-chatroom-text-muted hover:text-chatroom-accent opacity-0 group-hover:opacity-100 transition-all"
          title="Move to queue"
        >
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

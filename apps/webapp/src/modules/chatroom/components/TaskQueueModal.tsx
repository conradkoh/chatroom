'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Search, Pencil, Trash2 } from 'lucide-react';
import React, { useState, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { getScoringBadge } from './backlog';
import type { TaskStatus, TaskOrigin } from '../../../domain/entities/task';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

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

interface TaskQueueModalProps {
  isOpen: boolean;
  tasks: Task[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
}

// Status badge colors
const getStatusBadge = (status: TaskStatus) => {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'acknowledged':
      return {
        label: 'Acknowledged',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'in_progress':
      return {
        label: 'In Progress',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'completed':
      return {
        label: 'Completed',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    default:
      return {
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

export function TaskQueueModal({ isOpen, tasks, onClose, onTaskClick }: TaskQueueModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

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
    };

    for (const task of filteredTasks) {
      if (
        task.status === 'pending' ||
        task.status === 'acknowledged' ||
        task.status === 'in_progress'
      ) {
        groups.current.push(task);
      }
    }

    return groups;
  }, [filteredTasks]);

  if (!isOpen) {
    return null;
  }

  return (
    <FixedModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-2xl"
      className="sm:max-h-[85vh]"
    >
      <FixedModalContent>
        <FixedModalHeader onClose={onClose} className="py-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              All Tasks
            </span>
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Task Queue ({tasks.length})
            </span>
          </div>
        </FixedModalHeader>

        <FixedModalBody className="flex flex-col min-h-0 p-0">
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

          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-chatroom-text-muted text-sm">
                {searchQuery ? 'No tasks match your search' : 'No tasks found'}
              </div>
            ) : (
              <>
                {groupedTasks.current.length > 0 && (
                  <TaskGroup
                    title="Current"
                    tasks={groupedTasks.current}
                    onTaskClick={onTaskClick}
                    isProtected
                  />
                )}
              </>
            )}
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}

// Task Group Component
interface TaskGroupProps {
  title: string;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  isProtected?: boolean;
}

function TaskGroup({ title, tasks, onTaskClick, isProtected = false }: TaskGroupProps) {
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
  isProtected?: boolean;
  onStartEdit?: () => void;
  onDelete?: () => void;
}

function TaskListItem({
  task,
  onClick,
  isProtected = false,
  onStartEdit,
  onDelete,
}: TaskListItemProps) {
  const badge = getStatusBadge(task.status);
  const hasScoring = task.complexity || task.value || task.priority !== undefined;

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
      {task.assignedTo && (
        <span className="text-[9px] text-chatroom-text-muted">→ {task.assignedTo}</span>
      )}

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

      {/* Content - with simplified markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Actions for editable tasks */}
      {!isProtected && (
        <div className="flex items-center gap-1">
          {onStartEdit && (
            <button
              type="button"
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
              type="button"
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

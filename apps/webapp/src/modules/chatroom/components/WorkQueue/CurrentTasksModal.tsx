'use client';

import { X } from 'lucide-react';
import React, { useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { compactMarkdownComponents } from '../markdown-utils';
import type { Task } from './types';
import { getStatusBadge, formatRelativeTime } from './utils';

// Current Tasks Modal Component
export interface CurrentTasksModalProps {
  tasks: Task[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
}

export function CurrentTasksModal({ tasks, onClose, onTaskClick }: CurrentTasksModalProps) {
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
export interface CurrentTasksModalItemProps {
  task: Task;
  onClick: () => void;
}

export function CurrentTasksModalItem({ task, onClick }: CurrentTasksModalItemProps) {
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

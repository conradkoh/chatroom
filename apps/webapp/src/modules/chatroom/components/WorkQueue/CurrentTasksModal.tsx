'use client';

import React from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { compactMarkdownComponents } from '../markdown-utils';
import type { Task } from './types';
import { getStatusBadge, formatRelativeTime } from './utils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

// Current Tasks Modal Component
export interface CurrentTasksModalProps {
  tasks: Task[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
}

export function CurrentTasksModal({ tasks, onClose, onTaskClick }: CurrentTasksModalProps) {
  return (
    <FixedModal isOpen onClose={onClose} maxWidth="max-w-xl" className="sm:max-h-[70vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose} className="py-4">
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            Current Tasks ({tasks.length})
          </span>
        </FixedModalHeader>

        <FixedModalBody className="p-0">
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">No current tasks</div>
          ) : (
            tasks.map((task) => (
              <CurrentTasksModalItem key={task._id} task={task} onClick={() => onTaskClick(task)} />
            ))
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
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

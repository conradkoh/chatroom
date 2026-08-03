'use client';

import { XCircle } from 'lucide-react';
import React from 'react';

import type { Task } from './types';
import { getStatusBadge, formatRelativeTime } from './utils';
import { WorkQueuePreviewText } from './WorkQueuePreviewText';
import { MessageAttachmentChips } from '../../attachments';

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
  /** Cancel the active enhancer job for an enhancer-assigned task. */
  onCancelEnhancer?: (task: Task) => void;
  isCancellingEnhancer?: boolean;
}

export function CurrentTasksModal({
  tasks,
  onClose,
  onTaskClick,
  onCancelEnhancer,
  isCancellingEnhancer = false,
}: CurrentTasksModalProps) {
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
              <CurrentTasksModalItem
                key={task._id}
                task={task}
                onClick={() => onTaskClick(task)}
                onCancelEnhancer={onCancelEnhancer}
                isCancellingEnhancer={isCancellingEnhancer}
              />
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
  onCancelEnhancer?: (task: Task) => void;
  isCancellingEnhancer?: boolean;
}

// fallow-ignore-next-line complexity
export function CurrentTasksModalItem({
  task,
  onClick,
  onCancelEnhancer,
  isCancellingEnhancer = false,
}: CurrentTasksModalItemProps) {
  const badge = getStatusBadge(task.status);
  const relativeTime = task.updatedAt ? formatRelativeTime(task.updatedAt) : '';

  const taskHasAttachments =
    (task.attachedTasks?.length ?? 0) > 0 ||
    (task.attachedBacklogItems?.length ?? 0) > 0 ||
    (task.attachedMessages?.length ?? 0) > 0 ||
    (task.attachedSnippets?.length ?? 0) > 0;

  return (
    <div
      className="p-3 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group border-b border-chatroom-border last:border-b-0"
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
      <div className="flex items-start gap-3">
        {/* Status Badge */}
        <span
          className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
        >
          {badge.label}
        </span>

        {/* Content - plain text preview */}
        <WorkQueuePreviewText content={task.content} className="flex-1 min-w-0" />

        {/* Assigned To */}
        {task.assignedTo && (
          <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">
            → {task.assignedTo}
          </span>
        )}

        {/* Relative Time */}
        <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>

        {/* Cancel enhancer — inline trailing control (no separate actions row) */}
        {task.assignedTo === 'enhancer' && onCancelEnhancer && (
          <button
            type="button"
            data-testid="cancel-enhancer-modal-item"
            title="Cancel planning review"
            disabled={isCancellingEnhancer}
            onClick={(e) => {
              e.stopPropagation();
              onCancelEnhancer(task);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="flex-shrink-0 p-1 text-chatroom-text-muted hover:text-chatroom-status-error transition-colors disabled:opacity-50"
          >
            <XCircle size={12} />
          </button>
        )}
      </div>

      {/* Attachment chips */}
      {taskHasAttachments && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <MessageAttachmentChips
            message={{
              _id: task._id,
              type: 'task',
              senderRole: 'user',
              content: task.content,
              _creationTime: task.createdAt,
              attachedTasks: task.attachedTasks,
              attachedBacklogItems: task.attachedBacklogItems,
              attachedMessages: task.attachedMessages,
              attachedSnippets: task.attachedSnippets,
            }}
          />
        </div>
      )}
    </div>
  );
}

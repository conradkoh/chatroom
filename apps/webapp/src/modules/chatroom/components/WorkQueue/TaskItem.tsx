import { Trash2, XCircle } from 'lucide-react';

import type { Task } from './types';
import { getStatusBadge } from './utils';
import { WorkQueuePreviewText } from './WorkQueuePreviewText';
import { MessageAttachmentChips } from '../../attachments';

export interface TaskItemProps {
  task: Task;
  isProtected?: boolean;
  onDelete?: () => void;
  onClick?: () => void;
  /** Show the cancel-enhancer control for enhancer-assigned current tasks. */
  showCancelEnhancer?: boolean;
  onCancelEnhancer?: () => void;
  isCancellingEnhancer?: boolean;
}

// fallow-ignore-next-line complexity
export function TaskItem({
  task,
  isProtected = false,
  onDelete,
  onClick,
  showCancelEnhancer = false,
  onCancelEnhancer,
  isCancellingEnhancer = false,
}: TaskItemProps) {
  const badge = getStatusBadge(task.status);

  const isClickable = !!onClick;

  const taskHasAttachments =
    (task.attachedTasks?.length ?? 0) > 0 ||
    (task.attachedBacklogItems?.length ?? 0) > 0 ||
    (task.attachedMessages?.length ?? 0) > 0 ||
    (task.attachedSnippets?.length ?? 0) > 0;

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

      {/* Content - Plain text preview */}
      <WorkQueuePreviewText content={task.content} className="mb-2" />

      {/* Attachment chips */}
      {taskHasAttachments ? (
        <div className="mb-2" onClick={(e) => e.stopPropagation()}>
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
      ) : null}

      {/* Cancel enhancer — rendered outside the !isProtected gate so it works for current tasks */}
      {showCancelEnhancer && onCancelEnhancer && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="cancel-enhancer-task"
            title="Cancel planning review"
            disabled={isCancellingEnhancer}
            onClick={(e) => {
              e.stopPropagation();
              onCancelEnhancer();
            }}
            className="p-1 text-chatroom-text-muted hover:text-chatroom-status-error transition-colors disabled:opacity-50"
          >
            <XCircle size={12} />
          </button>
        </div>
      )}

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

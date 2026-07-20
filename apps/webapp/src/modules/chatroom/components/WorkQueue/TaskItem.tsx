import { Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';

import { MessageAttachmentChips } from '../../attachments';
import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import { baseMarkdownComponents, compactProseClassNames } from '../markdown-utils';
import type { Task } from './types';
import { getStatusBadge } from './utils';

export interface TaskItemProps {
  task: Task;
  isProtected?: boolean;
  onDelete?: () => void;
  onClick?: () => void;
}

// fallow-ignore-next-line complexity
export function TaskItem({ task, isProtected = false, onDelete, onClick }: TaskItemProps) {
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

      {/* Content - Rendered as Markdown */}
      <div className={`line-clamp-3 mb-2 ${compactProseClassNames}`}>
        <Markdown remarkPlugins={chatroomRemarkPlugins} components={baseMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

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

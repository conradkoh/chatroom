import { Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { baseMarkdownComponents } from '../markdown-utils';
import { getStatusBadge } from './utils';
import type { Task } from './types';

export interface TaskItemProps {
  task: Task;
  isProtected?: boolean;
  onDelete?: () => void;
  onClick?: () => void;
}

export function TaskItem({ task, isProtected = false, onDelete, onClick }: TaskItemProps) {
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

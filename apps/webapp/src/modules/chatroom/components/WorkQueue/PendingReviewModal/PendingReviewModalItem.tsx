import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { compactMarkdownComponents } from '../../markdown-utils';
import { formatRelativeTime } from '../utils';
import type { Task } from '../types';

export interface PendingReviewModalItemProps {
  task: Task;
  onClick: () => void;
}

export function PendingReviewModalItem({ task, onClick }: PendingReviewModalItemProps) {
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
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {task.content}
        </Markdown>
      </div>

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>
    </div>
  );
}

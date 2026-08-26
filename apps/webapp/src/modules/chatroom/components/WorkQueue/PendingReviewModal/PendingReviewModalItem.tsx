import type { Task } from '../types';
import { formatRelativeTime } from '../utils';
import { WorkQueuePreviewText } from '../WorkQueuePreviewText';

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

      {/* Content - plain text preview */}
      <WorkQueuePreviewText content={task.content} className="flex-1 min-w-0" />

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>
    </div>
  );
}

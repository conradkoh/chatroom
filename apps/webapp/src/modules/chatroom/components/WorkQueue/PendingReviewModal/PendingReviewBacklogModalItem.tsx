import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { type BacklogItem, getScoringBadge } from '../../backlog';
import { compactMarkdownComponents } from '../../markdown-utils';
import { formatRelativeTime } from '../utils';

export interface PendingReviewBacklogModalItemProps {
  item: BacklogItem;
  onClick: () => void;
}

export function PendingReviewBacklogModalItem({
  item,
  onClick,
}: PendingReviewBacklogModalItemProps) {
  const relativeTime = item.updatedAt ? formatRelativeTime(item.updatedAt) : '';

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

      {/* Scoring badges */}
      {(item.complexity || item.value || item.priority !== undefined) && (
        <div className="flex-shrink-0 flex items-center gap-1">
          {item.priority !== undefined && (
            <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
              P:{item.priority}
            </span>
          )}
          {item.complexity && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
            >
              {getScoringBadge('complexity', item.complexity).label}
            </span>
          )}
          {item.value && (
            <span
              className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
            >
              {getScoringBadge('value', item.value).label}
            </span>
          )}
        </div>
      )}

      {/* Content - with markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {item.content}
        </Markdown>
      </div>

      {/* Relative Time */}
      <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted">{relativeTime}</span>
    </div>
  );
}

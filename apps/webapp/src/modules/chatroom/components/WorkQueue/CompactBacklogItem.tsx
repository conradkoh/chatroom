import { ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { type BacklogItem, getScoringBadge } from '../backlog';
import { compactMarkdownComponents } from '../markdown-utils';

export interface CompactBacklogItemProps {
  item: BacklogItem;
  onClick: () => void;
}

// compactMarkdownComponents is imported from markdown-utils.tsx

export function CompactBacklogItem({ item, onClick }: CompactBacklogItemProps) {
  const hasScoring = item.complexity || item.value || item.priority !== undefined;

  return (
    <div
      className="flex items-center gap-2 p-2 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group"
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
      {/* Scoring badges */}
      {hasScoring && (
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

      {/* Content - 2 lines max, with simplified markdown */}
      <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-2">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={compactMarkdownComponents}>
          {item.content}
        </Markdown>
      </div>

      {/* Arrow to indicate clickable */}
      <ChevronRight
        size={14}
        className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
      />
    </div>
  );
}

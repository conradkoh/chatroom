import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ViewMoreButton } from './ViewMoreButton';

/** Max items shown per sidebar section before "View More". */
export const SIDEBAR_PREVIEW_LIMIT = 3;

export interface WorkQueueSectionProps {
  title: string;
  count: number;
  icon: LucideIcon;
  iconClassName?: string;
  headerAction?: ReactNode;
  emptyMessage: string;
  children: ReactNode;
  viewMoreCount?: number;
  onViewMore?: () => void;
}

export function WorkQueueSection({
  title,
  count,
  icon: Icon,
  iconClassName,
  headerAction,
  emptyMessage,
  children,
  viewMoreCount = 0,
  onViewMore,
}: WorkQueueSectionProps) {
  const hasItems = count > 0;

  return (
    <div className="border-b border-chatroom-border">
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={12} className={iconClassName} />
          <span>
            {title} ({count})
          </span>
        </div>
        {headerAction ?? null}
      </div>
      {hasItems ? (
        <>
          {children}
          {viewMoreCount > 0 && onViewMore ? (
            <ViewMoreButton count={viewMoreCount} onClick={onViewMore} />
          ) : null}
        </>
      ) : (
        <div className="p-3 text-center text-chatroom-text-muted text-xs">{emptyMessage}</div>
      )}
    </div>
  );
}

'use client';

import { Clock } from 'lucide-react';

const BADGE_CLASS =
  'inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-chatroom-text-muted bg-chatroom-bg-hover rounded flex-shrink-0';

interface ScheduledMessageBadgeProps {
  scheduledPromptId?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function ScheduledMessageBadge({ scheduledPromptId, onClick }: ScheduledMessageBadgeProps) {
  if (scheduledPromptId && onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        className={`${BADGE_CLASS} cursor-pointer hover:text-chatroom-text-primary`}
        title="View scheduled prompt details"
        data-testid="scheduled-message-badge"
      >
        <Clock size={10} />
        Scheduled
      </button>
    );
  }
  return (
    <span className={BADGE_CLASS} data-testid="scheduled-message-badge">
      <Clock size={10} />
      Scheduled
    </span>
  );
}

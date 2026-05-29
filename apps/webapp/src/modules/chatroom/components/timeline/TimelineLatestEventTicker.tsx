'use client';

import { ChevronRight } from 'lucide-react';
import { memo } from 'react';

import {
  type EventStreamEvent,
  formatEventType,
  getEventBadgeTextColor,
} from '../../viewModels/eventStreamViewModel';

function getWorkflowEventDetail(event: EventStreamEvent): string | null {
  switch (event.type) {
    case 'workflow.created':
    case 'workflow.started':
      return `${event.stepCount} steps`;
    case 'workflow.stepCompleted':
    case 'workflow.stepStarted':
    case 'workflow.stepCancelled':
    case 'workflow.specified':
      return event.stepKey;
    case 'workflow.completed':
      return event.finalStatus === 'completed' ? 'all steps done' : 'cancelled';
    default:
      return null;
  }
}

export const TimelineLatestEventTicker = memo(function TimelineLatestEventTicker({
  event,
  onClick,
}: {
  event: EventStreamEvent | null;
  onClick: () => void;
}) {
  if (!event) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 min-w-0 text-[10px] text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors cursor-pointer px-2 py-1 rounded"
      >
        <span className="uppercase tracking-wider font-bold whitespace-nowrap truncate min-w-0">
          Event Stream
        </span>
        <ChevronRight size={10} className="opacity-50 shrink-0" />
      </button>
    );
  }

  const workflowDetail = getWorkflowEventDetail(event);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 min-w-0 text-[10px] text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 cursor-pointer px-2 py-1 rounded"
    >
      <span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
        <span
          className={`font-bold uppercase tracking-wider whitespace-nowrap shrink-0 ${getEventBadgeTextColor(event.type)}`}
        >
          {formatEventType(event.type)}
        </span>
        {workflowDetail && (
          <span className="text-chatroom-text-secondary uppercase tracking-wider font-bold whitespace-nowrap truncate min-w-0">
            {workflowDetail}
          </span>
        )}
        {'role' in event && event.role && (
          <span className="text-chatroom-text-secondary uppercase tracking-wider font-bold whitespace-nowrap truncate min-w-0">
            {event.role}
          </span>
        )}
      </span>
      <ChevronRight size={10} className="opacity-50 ml-0.5 shrink-0" />
    </button>
  );
});

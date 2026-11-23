'use client';

import { memo, type ReactNode } from 'react';

import { TimelineContextMessage } from './TimelineContextMessage';
import { TimelineRowErrorBoundary } from './TimelineRowErrorBoundary';
import { TimelineTeamMessage } from './TimelineTeamMessage';
import { TimelineUserMessage } from './TimelineUserMessage';
import { isEagerTimelineEvent } from '../../timeline/isEagerTimelineEvent';
import type { TimelineEvent } from '../../timeline/types';

export interface TimelineEventRowProps {
  event: TimelineEvent;
  chatroomId: string;
}

function renderTimelineEventCell(event: TimelineEvent, chatroomId: string): ReactNode {
  switch (event.kind) {
    case 'user_message':
      return <TimelineUserMessage message={event.message} chatroomId={chatroomId} />;
    case 'context':
      return <TimelineContextMessage message={event.message} />;
    case 'team_message':
      return (
        <TimelineTeamMessage
          message={event.message}
          handoffDurationMs={event.handoffDurationMs}
          handoffDurationSlow={event.handoffDurationSlow}
          chatroomId={chatroomId}
          collapsible={!isEagerTimelineEvent(event)}
        />
      );
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * One timeline row. The boundary adds no DOM wrapper: it renders `children` directly, so
 * the sticky header and virtualizer measurements stay tied to the cell. Every event kind
 * goes through it, so a single failing row cannot take down the timeline or the app.
 */
export const TimelineEventRow = memo(function TimelineEventRow({
  event,
  chatroomId,
}: TimelineEventRowProps) {
  return (
    <TimelineRowErrorBoundary messageId={event.message._id} content={event.message.content}>
      {renderTimelineEventCell(event, chatroomId)}
    </TimelineRowErrorBoundary>
  );
});

'use client';

import { memo } from 'react';

import { TimelineContextMessage } from './TimelineContextMessage';
import { TimelineTeamMessage } from './TimelineTeamMessage';
import { TimelineUserMessage } from './TimelineUserMessage';
import { isEagerTimelineEvent } from '../../timeline/isEagerTimelineEvent';
import type { TimelineEvent } from '../../timeline/types';

export interface TimelineEventRowProps {
  event: TimelineEvent;
  chatroomId: string;
}

export const TimelineEventRow = memo(function TimelineEventRow({
  event,
  chatroomId,
}: TimelineEventRowProps) {
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
});

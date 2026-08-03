'use client';

import { memo } from 'react';

import { TimelineContextMessage } from './TimelineContextMessage';
import type { MachineNameEntry, TimelineMessageHeaderNavigation } from './timelineRowStyles';
import { TimelineTeamMessage, type TimelineTeamMessageProps } from './TimelineTeamMessage';
import { TimelineUserMessage } from './TimelineUserMessage';
import type { TimelineEvent } from '../../timeline/types';

export interface TimelineEventRowProps {
  event: TimelineEvent;
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  /** Optional machine id for team rows (hostname via `machines` map). */
  machineId?: TimelineTeamMessageProps['machineId'];
  /** When set, sticky header shows centered prev/current/next jump controls (All tab). */
  headerNavigation?: TimelineMessageHeaderNavigation;
}

export const TimelineEventRow = memo(function TimelineEventRow({
  event,
  chatroomId,
  machines,
  machineId,
  headerNavigation,
}: TimelineEventRowProps) {
  switch (event.kind) {
    case 'user_message':
      return (
        <TimelineUserMessage
          message={event.message}
          chatroomId={chatroomId}
          headerNavigation={headerNavigation}
        />
      );
    case 'context':
      return <TimelineContextMessage message={event.message} />;
    case 'team_message':
      return (
        <TimelineTeamMessage
          message={event.message}
          chatroomId={chatroomId}
          machines={machines}
          machineId={machineId}
          headerNavigation={headerNavigation}
        />
      );
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
});

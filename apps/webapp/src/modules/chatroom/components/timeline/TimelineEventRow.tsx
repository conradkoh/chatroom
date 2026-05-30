'use client';

import { memo } from 'react';

import type { TimelineEvent } from '../../timeline/types';

import { TimelineContextMessage } from './TimelineContextMessage';
import { TimelineTeamMessage, type TimelineTeamMessageProps } from './TimelineTeamMessage';
import { TimelineUserMessage } from './TimelineUserMessage';
import type { MachineNameEntry } from './timelineRowStyles';

export interface TimelineEventRowProps {
  event: TimelineEvent;
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  /** Optional machine id for team rows (hostname via `machines` map). */
  machineId?: TimelineTeamMessageProps['machineId'];
}

export const TimelineEventRow = memo(function TimelineEventRow({
  event,
  chatroomId,
  machines,
  machineId,
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
          chatroomId={chatroomId}
          machines={machines}
          machineId={machineId}
        />
      );
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
});

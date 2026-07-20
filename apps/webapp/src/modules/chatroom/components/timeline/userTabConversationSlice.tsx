'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type React from 'react';

import { ConversationSlicePanel } from './ConversationSlicePanel';
import { TimelineEventRow } from './TimelineEventRow';
import type { MachineNameEntry } from './timelineRowStyles';
import type { TimelineEvent } from '../../timeline/types';

import { cn } from '@/lib/utils';

export function SelectableUserMessageRow({
  event,
  chatroomId,
  machines,
  selectedAnchorId,
  onSelect,
}: {
  event: TimelineEvent;
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  selectedAnchorId: Id<'chatroom_messages'> | null;
  onSelect: (messageId: Id<'chatroom_messages'>) => void;
}) {
  const row = <TimelineEventRow event={event} chatroomId={chatroomId} machines={machines} />;

  if (event.kind !== 'user_message') {
    return row;
  }

  const messageId = event.id as Id<'chatroom_messages'>;
  const selectMessage = () => onSelect(messageId);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={selectMessage}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectMessage();
        }
      }}
      className={cn(
        'w-full text-left cursor-pointer transition-colors hover:bg-chatroom-bg-hover/40',
        selectedAnchorId === messageId && 'ring-2 ring-inset ring-chatroom-accent/50'
      )}
      data-testid={`conversation-anchor-${event.id}`}
    >
      {row}
    </div>
  );
}

export function UserTabConversationShell({
  timelineBody,
  chatroomId,
  machines,
  selectedAnchorId,
  onClose,
}: {
  timelineBody: React.ReactNode;
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  selectedAnchorId: Id<'chatroom_messages'> | null;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 min-h-0 overflow-hidden" data-testid="chatroom-timeline-feed">
      <div
        className={cn(
          'flex flex-col min-h-0',
          selectedAnchorId
            ? 'hidden md:flex md:w-2/5 lg:w-1/3 border-r-2 border-chatroom-border-strong'
            : 'flex-1 w-full'
        )}
      >
        {timelineBody}
      </div>

      {selectedAnchorId && (
        <>
          <div className="hidden md:flex flex-1 min-h-0 min-w-0">
            <ConversationSlicePanel
              chatroomId={chatroomId}
              anchorMessageId={selectedAnchorId}
              onClose={onClose}
              machines={machines}
            />
          </div>
          <div className="md:hidden fixed inset-0 top-14 z-40 flex flex-col bg-chatroom-bg-primary">
            <ConversationSlicePanel
              chatroomId={chatroomId}
              anchorMessageId={selectedAnchorId}
              onClose={onClose}
              machines={machines}
            />
          </div>
        </>
      )}
    </div>
  );
}

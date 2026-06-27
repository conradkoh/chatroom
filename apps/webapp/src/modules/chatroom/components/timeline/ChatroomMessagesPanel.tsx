'use client';

import type React from 'react';

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';
import { FilteredUserMessagesView } from './FilteredUserMessagesView';
import { MessageViewToggle } from './MessageViewToggle';
import type { MachineNameEntry } from './timelineRowStyles';
import { useMessageViewMode } from '../../hooks/persistence/useMessageViewMode';
import type { TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';

export interface ChatroomMessagesPanelProps {
  chatroomId: string;
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  onRegisterOpenEventStream?: (openFn: () => void) => void;
  machines?: Map<string, MachineNameEntry>;
  /** Optional footer (MessageInput) rendered below feed */
  footer?: React.ReactNode;
}

export function ChatroomMessagesPanel({
  chatroomId,
  coordinator,
  onRegisterOpenEventStream,
  machines,
  footer,
}: ChatroomMessagesPanelProps) {
  const [viewMode, setViewMode] = useMessageViewMode(chatroomId);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 h-8 border-b border-chatroom-border flex items-center px-2">
        <MessageViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === 'all' ? (
        <ChatroomTimelineFeed
          chatroomId={chatroomId}
          coordinator={coordinator}
          onRegisterOpenEventStream={onRegisterOpenEventStream}
          machines={machines}
        />
      ) : (
        <FilteredUserMessagesView chatroomId={chatroomId} machines={machines} />
      )}

      {footer}
    </div>
  );
}

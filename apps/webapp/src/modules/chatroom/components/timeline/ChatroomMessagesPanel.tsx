'use client';

import type React from 'react';

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';
import { FilteredUserMessagesView } from './FilteredUserMessagesView';
import type { MachineNameEntry } from './timelineRowStyles';
import {
  isFilteredMessageViewMode,
  messageViewModeToSenderRole,
  type MessageViewMode,
} from '../../hooks/persistence/messageViewMode';
import type { TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';

export interface ChatroomMessagesPanelProps {
  chatroomId: string;
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  onRegisterOpenEventStream?: (openFn: () => void) => void;
  onRegisterMessageStoreActions?: (actions: {
    removeMessagesForTask: (taskId: string) => void;
  }) => void;
  machines?: Map<string, MachineNameEntry>;
  viewMode: MessageViewMode;
  /** Optional footer (MessageInput) rendered below feed */
  footer?: React.ReactNode;
}

export function ChatroomMessagesPanel({
  chatroomId,
  coordinator,
  onRegisterOpenEventStream,
  onRegisterMessageStoreActions,
  machines,
  viewMode,
  footer,
}: ChatroomMessagesPanelProps) {
  const filterRole = isFilteredMessageViewMode(viewMode)
    ? messageViewModeToSenderRole(viewMode)
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      {filterRole === null ? (
        <ChatroomTimelineFeed
          chatroomId={chatroomId}
          coordinator={coordinator}
          onRegisterOpenEventStream={onRegisterOpenEventStream}
          onRegisterMessageStoreActions={onRegisterMessageStoreActions}
          machines={machines}
        />
      ) : (
        <FilteredUserMessagesView
          chatroomId={chatroomId}
          senderRole={filterRole}
          machines={machines}
        />
      )}

      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );
}
